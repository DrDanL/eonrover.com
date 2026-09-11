import { Prisma } from '@prisma/client';
import { ResourceAmounts, storageCapacity } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type TransportCompletionOutcome =
  | 'delivered'
  | 'awaiting-capacity'
  | 'returned'
  | 'early'
  | 'noop'
  | 'unavailable';

type CanonicalTransport = {
  ships: { transporter: number };
  originalCargo: ResourceAmounts;
  remainingCargo: ResourceAmounts;
  returnDurationSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function resourceSnapshot(value: unknown): ResourceAmounts | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { alloy, heliox, aether } = value;
  if (!nonNegativeSafeInteger(alloy) || !nonNegativeSafeInteger(heliox) || !nonNegativeSafeInteger(aether)) {
    return null;
  }
  return { alloy, heliox, aether };
}

function transporterSnapshot(value: unknown): { transporter: number } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.transporter !== 'number') return null;
  if (!Number.isSafeInteger(value.transporter) || value.transporter < 1 || value.transporter > 100) return null;
  return { transporter: value.transporter };
}

function sameResources(left: ResourceAmounts, right: ResourceAmounts): boolean {
  return left.alloy === right.alloy && left.heliox === right.heliox && left.aether === right.aether;
}

function zeroResources(value: ResourceAmounts): boolean {
  return value.alloy === 0 && value.heliox === 0 && value.aether === 0;
}

function canonicalTransport(mission: {
  transportShips: unknown;
  transportCargo: unknown;
  transportRemainingCargo: unknown;
  transportCapacity: number | null;
  transportOutboundFuelHeliox: number | null;
  transportReturnFuelHeliox: number | null;
  transportTotalReservedFuelHeliox: number | null;
  transportOutboundDurationSeconds: number | null;
  transportReturnDurationSeconds: number | null;
}): CanonicalTransport | null {
  const ships = transporterSnapshot(mission.transportShips);
  const originalCargo = resourceSnapshot(mission.transportCargo);
  const remainingCargo = resourceSnapshot(mission.transportRemainingCargo);
  if (!ships || !originalCargo || !remainingCargo
    || !nonNegativeSafeInteger(mission.transportCapacity)
    || !nonNegativeSafeInteger(mission.transportOutboundFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportReturnFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportTotalReservedFuelHeliox)
    || !nonNegativeSafeInteger(mission.transportOutboundDurationSeconds)
    || !nonNegativeSafeInteger(mission.transportReturnDurationSeconds)
    || mission.transportOutboundDurationSeconds === 0 || mission.transportReturnDurationSeconds === 0
    || mission.transportTotalReservedFuelHeliox !== mission.transportOutboundFuelHeliox + mission.transportReturnFuelHeliox
    || mission.transportCapacity! < originalCargo.alloy + originalCargo.heliox + originalCargo.aether) return null;
  return { ships, originalCargo, remainingCargo, returnDurationSeconds: mission.transportReturnDurationSeconds };
}

function resourceJson(resources: ResourceAmounts): Prisma.InputJsonObject {
  return { alloy: resources.alloy, heliox: resources.heliox, aether: resources.aether };
}

function capacitiesFor(buildings: Array<{ key: string; level: number }>): ResourceAmounts {
  const levels = new Map(buildings.map((building) => [building.key, building.level]));
  return {
    alloy: storageCapacity(levels.get('alloyStorage') ?? 0),
    heliox: storageCapacity(levels.get('helioxStorage') ?? 0),
    aether: storageCapacity(levels.get('aetherStorage') ?? 0),
  };
}

function fits(resources: ResourceAmounts, capacity: ResourceAmounts, cargo: ResourceAmounts): boolean {
  return resources.alloy + cargo.alloy <= capacity.alloy
    && resources.heliox + cargo.heliox <= capacity.heliox
    && resources.aether + cargo.aether <= capacity.aether;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}

/**
 * Applies one authoritative step of a canonical transport lifecycle. It is
 * internal-only: callers provide a persisted mission id and a time boundary;
 * generic Fleet JSON and queued payload data are never authority sources.
 */
export async function settleCanonicalTransport(
  missionId: string,
  currentTime = new Date(),
): Promise<TransportCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';
  const config = await getUniverseConfig();

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Canonical lock order: account → origin → destination → mission →
        // destination resource state (or origin Transporter inventory on return).
        const accountLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT account."id" AS "id"
          FROM "User" AS account
          JOIN "Planet" AS origin ON origin."ownerId" = account."id"
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF account
        `;
        if (accountLocks.length !== 1) return 'noop';
        const account = await tx.user.findUnique({ where: { id: accountLocks[0].id }, select: { id: true } });
        if (!account) return 'noop';

        const originLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT origin."id" AS "id"
          FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF origin
        `;
        if (originLocks.length !== 1) return 'noop';
        const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
        if (!origin) return 'noop';

        const destinationLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT destination."id" AS "id"
          FROM "Planet" AS destination
          JOIN "FleetMission" AS mission ON mission."transportDestinationId" = destination."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF destination
        `;
        if (destinationLocks.length !== 1) return 'noop';
        const destination = await tx.planet.findUnique({ where: { id: destinationLocks[0].id } });
        if (!destination) return 'noop';

        await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
        const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.missionType !== 'TRANSPORT' || !mission.transportPhase) return 'noop';
        if (
          mission.transportOriginId !== origin.id
          || mission.transportDestinationId !== destination.id
          || origin.ownerId !== account.id
          || destination.ownerId !== account.id
          || mission.speedPercent !== 100
          || !Number.isFinite(mission.arrivesAt.getTime())
        ) return 'noop';

        const canonical = canonicalTransport(mission);
        if (!canonical) return 'noop';

        if (mission.transportPhase === 'OUTBOUND') {
          if (mission.status !== 'OUTBOUND' || mission.arrivesAt > currentTime || !sameResources(canonical.originalCargo, canonical.remainingCargo)) {
            return mission.arrivesAt > currentTime ? 'early' : 'noop';
          }

          const syncedDestination = await syncLockedPlanetResources(tx, destination, currentTime, config.economySpeed);
          const capacity = capacitiesFor(syncedDestination.buildings);
          if (!fits(syncedDestination.planet, capacity, canonical.remainingCargo)) {
            const wait = await tx.fleetMission.updateMany({
              where: { id: mission.id, transportPhase: 'OUTBOUND', status: 'OUTBOUND' },
              data: { transportPhase: 'AWAITING_DESTINATION_CAPACITY' },
            });
            if (wait.count === 1) {
              await tx.notification.create({
                data: {
                  userId: account.id,
                  type: 'TRANSPORT_AWAITING_CAPACITY',
                  message: 'A transport mission is waiting for destination storage capacity.',
                },
              });
            }
            return 'awaiting-capacity';
          }

          return deliverCargo(tx, mission, account.id, syncedDestination.planet, canonical, currentTime);
        }

        if (mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY') {
          if (mission.status !== 'OUTBOUND' || !sameResources(canonical.originalCargo, canonical.remainingCargo)) return 'noop';
          const syncedDestination = await syncLockedPlanetResources(tx, destination, currentTime, config.economySpeed);
          const capacity = capacitiesFor(syncedDestination.buildings);
          if (!fits(syncedDestination.planet, capacity, canonical.remainingCargo)) return 'awaiting-capacity';
          return deliverCargo(tx, mission, account.id, syncedDestination.planet, canonical, currentTime);
        }

        if (mission.transportPhase === 'RETURNING') {
          if (mission.status !== 'RETURNING' || !mission.returnsAt || !Number.isFinite(mission.returnsAt.getTime()) || !zeroResources(canonical.remainingCargo)) return 'noop';
          if (mission.returnsAt > currentTime) return 'early';

          await tx.$queryRaw`
            SELECT "id" FROM "Ship"
            WHERE "planetId" = ${origin.id} AND "key" = 'transporter'
            FOR UPDATE
          `;
          const completion = await tx.fleetMission.updateMany({
            where: { id: mission.id, transportPhase: 'RETURNING', status: 'RETURNING' },
            data: { transportPhase: 'COMPLETE', status: 'COMPLETE' },
          });
          if (completion.count !== 1) return 'noop';
          await tx.ship.upsert({
            where: { planetId_key: { planetId: origin.id, key: 'transporter' } },
            update: { count: { increment: canonical.ships.transporter } },
            create: { planetId: origin.id, key: 'transporter', count: canonical.ships.transporter },
          });
          await tx.notification.create({
            data: {
              userId: account.id,
              type: 'TRANSPORT_RETURNED',
              message: 'Transporters have returned to their origin planet.',
            },
          });
          return 'returned';
        }

        return 'noop';
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) return 'unavailable';
      throw error;
    }
  }

  return 'unavailable';
}

async function deliverCargo(
  tx: Prisma.TransactionClient,
  mission: { id: string },
  accountId: string,
  destination: { id: string; alloy: number; heliox: number; aether: number },
  canonical: CanonicalTransport,
  currentTime: Date,
): Promise<TransportCompletionOutcome> {
  const returnsAt = new Date(currentTime.getTime() + canonical.returnDurationSeconds * 1_000);
  const delivered = await tx.fleetMission.updateMany({
    where: {
      id: mission.id,
      status: 'OUTBOUND',
      transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY'] },
    },
    data: {
      status: 'RETURNING',
      transportPhase: 'RETURNING',
      transportRemainingCargo: resourceJson({ alloy: 0, heliox: 0, aether: 0 }),
      returnsAt,
    },
  });
  if (delivered.count !== 1) return 'noop';
  await tx.planet.update({
    where: { id: destination.id },
    data: {
      alloy: destination.alloy + canonical.remainingCargo.alloy,
      heliox: destination.heliox + canonical.remainingCargo.heliox,
      aether: destination.aether + canonical.remainingCargo.aether,
    },
  });
  await tx.notification.create({
    data: {
      userId: accountId,
      type: 'TRANSPORT_DELIVERED',
      message: 'A transport mission has delivered its cargo and is returning.',
    },
  });
  return 'delivered';
}

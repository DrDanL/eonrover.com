import { Prisma } from '@prisma/client';
import { ResourceAmounts, TransportMissionPlan, planTransportMission } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type TransportLaunchErrorCode =
  | 'ORIGIN_NOT_OWNED'
  | 'DESTINATION_NOT_OWNED'
  | 'IDENTICAL_PLANETS'
  | 'INVALID_TRANSPORT_INPUT'
  | 'INSUFFICIENT_TRANSPORTERS'
  | 'INSUFFICIENT_RESOURCES'
  | 'INSUFFICIENT_HELIOX'
  | 'TRANSPORT_IN_PROGRESS'
  | 'TRANSPORT_UNAVAILABLE';

/** Internal-only errors for a future, bounded same-owner transport command. */
export class TransportLaunchError extends Error {
  constructor(readonly code: TransportLaunchErrorCode, message: string) {
    super(message);
    this.name = 'TransportLaunchError';
  }
}

export interface TransportLaunchInput {
  userId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  transporterQuantity: unknown;
  cargo: unknown;
}

/** Safe internal acceptance data; no queue or raw persistence details. */
export interface AcceptedTransportLaunch {
  missionId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  ships: { transporter: number };
  cargo: ResourceAmounts;
  capacity: number;
  totalReservedFuelHeliox: number;
  outboundDurationSeconds: number;
  returnDurationSeconds: number;
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date;
  phase: 'OUTBOUND';
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}

function assertLaunchInput(input: TransportLaunchInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TransportLaunchError('INVALID_TRANSPORT_INPUT', 'The transport command is invalid.');
  }
  const allowed = new Set(['userId', 'originPlanetId', 'destinationPlanetId', 'transporterQuantity', 'cargo']);
  if (
    Object.keys(input).some((key) => !allowed.has(key))
    || typeof input.userId !== 'string'
    || !input.userId
    || typeof input.originPlanetId !== 'string'
    || !input.originPlanetId
    || typeof input.destinationPlanetId !== 'string'
    || !input.destinationPlanetId
  ) {
    throw new TransportLaunchError('INVALID_TRANSPORT_INPUT', 'The transport command is invalid.');
  }
}

function planForOwnedPlanets(
  input: TransportLaunchInput,
  origin: { galaxy: number; system: number; slot: number },
  destination: { galaxy: number; system: number; slot: number },
  fleetSpeed: number,
): TransportMissionPlan {
  try {
    return planTransportMission({
      origin,
      destination,
      quantity: input.transporterQuantity,
      cargo: input.cargo,
      fleetSpeed,
    });
  } catch {
    throw new TransportLaunchError('INVALID_TRANSPORT_INPUT', 'The Transporter quantity or cargo is invalid.');
  }
}

function cargoSnapshot(cargo: ResourceAmounts): Prisma.InputJsonObject {
  return { alloy: cargo.alloy, heliox: cargo.heliox, aether: cargo.aether };
}

/**
 * Atomically reserves Transporters, cargo, and round-trip Heliox for the
 * internal-only, same-owner transport lifecycle. PostgreSQL is authoritative;
 * Stage 10B3 deliberately creates neither a BullMQ job nor a side effect.
 */
export async function launchCanonicalTransport(input: TransportLaunchInput): Promise<AcceptedTransportLaunch> {
  assertLaunchInput(input);
  const config = await getUniverseConfig();

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Canonical lock order: account → origin planet → destination planet
        // → origin Transporter inventory → active canonical transport rows.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
        const account = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true } });
        if (!account || account.status !== 'ACTIVE') {
          throw new TransportLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }
        if (input.originPlanetId === input.destinationPlanetId) {
          throw new TransportLaunchError('IDENTICAL_PLANETS', 'A transport mission requires two distinct owned planets.');
        }

        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.originPlanetId} FOR UPDATE`;
        const origin = await tx.planet.findUnique({ where: { id: input.originPlanetId } });
        if (!origin || origin.ownerId !== account.id) {
          throw new TransportLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.destinationPlanetId} FOR UPDATE`;
        const destination = await tx.planet.findUnique({ where: { id: input.destinationPlanetId } });
        if (!destination || destination.ownerId !== account.id) {
          throw new TransportLaunchError('DESTINATION_NOT_OWNED', 'The destination planet is not available to this account.');
        }

        const plan = planForOwnedPlanets(input, origin, destination, config.fleetSpeed);
        const departedAt = new Date();
        const syncedOrigin = await syncLockedPlanetResources(tx, origin, departedAt, config.economySpeed);

        await tx.$queryRaw`
          SELECT "id" FROM "Ship"
          WHERE "planetId" = ${origin.id} AND "key" = 'transporter'
          FOR UPDATE
        `;
        const transporters = await tx.ship.findUnique({
          where: { planetId_key: { planetId: origin.id, key: 'transporter' } },
          select: { count: true },
        });

        await tx.$queryRaw`
          SELECT "id" FROM "FleetMission"
          WHERE "missionType" = 'TRANSPORT'
            AND "transportOriginId" = ${origin.id}
            AND "transportDestinationId" IS NOT NULL
            AND "transportPhase" IN ('OUTBOUND', 'AWAITING_DESTINATION_CAPACITY', 'RETURNING')
          FOR UPDATE
        `;
        const activeTransport = await tx.fleetMission.findFirst({
          where: {
            missionType: 'TRANSPORT',
            transportOriginId: origin.id,
            transportDestinationId: { not: null },
            transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY', 'RETURNING'] },
          },
          select: { id: true },
        });
        if (activeTransport) {
          throw new TransportLaunchError('TRANSPORT_IN_PROGRESS', 'A transport mission is already active from this planet.');
        }
        if (!transporters || transporters.count < plan.ships.transporter) {
          throw new TransportLaunchError('INSUFFICIENT_TRANSPORTERS', 'The origin planet does not have enough Transporters.');
        }
        if (
          syncedOrigin.planet.alloy < plan.cargo.alloy
          || syncedOrigin.planet.aether < plan.cargo.aether
        ) {
          throw new TransportLaunchError('INSUFFICIENT_RESOURCES', 'The origin planet does not have enough cargo resources.');
        }
        const requiredHeliox = plan.cargo.heliox + plan.totalReservedFuelHeliox;
        if (syncedOrigin.planet.heliox < requiredHeliox) {
          throw new TransportLaunchError('INSUFFICIENT_HELIOX', 'The origin planet does not have enough Heliox for cargo and return fuel.');
        }

        const reservation = await tx.ship.updateMany({
          where: { planetId: origin.id, key: 'transporter', count: { gte: plan.ships.transporter } },
          data: { count: { decrement: plan.ships.transporter } },
        });
        if (reservation.count !== 1) {
          throw new TransportLaunchError('INSUFFICIENT_TRANSPORTERS', 'The origin planet does not have enough Transporters.');
        }
        await tx.planet.update({
          where: { id: origin.id },
          data: {
            alloy: syncedOrigin.planet.alloy - plan.cargo.alloy,
            heliox: syncedOrigin.planet.heliox - requiredHeliox,
            aether: syncedOrigin.planet.aether - plan.cargo.aether,
          },
        });

        const arrivesAt = new Date(departedAt.getTime() + plan.outboundDurationSeconds * 1_000);
        const returnsAt = new Date(arrivesAt.getTime() + plan.returnDurationSeconds * 1_000);
        const acceptedCargo = cargoSnapshot(plan.cargo);
        const mission = await tx.fleetMission.create({
          data: {
            originId: origin.id,
            targetId: destination.id,
            targetGalaxy: destination.galaxy,
            targetSystem: destination.system,
            targetSlot: destination.slot,
            missionType: 'TRANSPORT',
            ships: plan.ships,
            cargo: acceptedCargo,
            speedPercent: plan.speedPercent,
            departedAt,
            arrivesAt,
            returnsAt,
            status: 'OUTBOUND',
            transportOriginId: origin.id,
            transportDestinationId: destination.id,
            transportShips: plan.ships,
            transportCargo: acceptedCargo,
            transportRemainingCargo: cargoSnapshot(plan.cargo),
            transportCapacity: plan.cargoCapacity,
            transportOutboundFuelHeliox: plan.outboundFuelHeliox,
            transportReturnFuelHeliox: plan.returnFuelHeliox,
            transportTotalReservedFuelHeliox: plan.totalReservedFuelHeliox,
            transportOutboundDurationSeconds: plan.outboundDurationSeconds,
            transportReturnDurationSeconds: plan.returnDurationSeconds,
            transportPhase: 'OUTBOUND',
          },
        });

        return {
          missionId: mission.id,
          originPlanetId: origin.id,
          destinationPlanetId: destination.id,
          ships: plan.ships,
          cargo: plan.cargo,
          capacity: plan.cargoCapacity,
          totalReservedFuelHeliox: plan.totalReservedFuelHeliox,
          outboundDurationSeconds: plan.outboundDurationSeconds,
          returnDurationSeconds: plan.returnDurationSeconds,
          departedAt,
          arrivesAt,
          returnsAt,
          phase: 'OUTBOUND' as const,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof TransportLaunchError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new TransportLaunchError('TRANSPORT_IN_PROGRESS', 'A transport mission is already active from this planet.');
      }
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) {
        throw new TransportLaunchError('TRANSPORT_UNAVAILABLE', 'Transport launch could not be completed. Please try again.');
      }
      throw error;
    }
  }

  throw new TransportLaunchError('TRANSPORT_UNAVAILABLE', 'Transport launch could not be completed. Please try again.');
}

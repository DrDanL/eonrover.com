import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  COLONY_STARTER_STATE,
  ColonizationPlan,
  deriveColonyCharacteristics,
  planSameSystemColonization,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { lockCoordinateForTransaction } from './coordinateLockService';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type ColonizationLaunchErrorCode =
  | 'ORIGIN_NOT_OWNED'
  | 'INVALID_TARGET'
  | 'TARGET_OCCUPIED'
  | 'TARGET_RESERVED'
  | 'INSUFFICIENT_COLONY_SHIPS'
  | 'INSUFFICIENT_HELIOX'
  | 'PLANET_LIMIT_REACHED'
  | 'COLONIZATION_IN_PROGRESS'
  | 'COLONIZATION_UNAVAILABLE';

/** Internal-only errors for a later bounded colonisation command layer. */
export class ColonizationLaunchError extends Error {
  constructor(readonly code: ColonizationLaunchErrorCode, message: string) {
    super(message);
    this.name = 'ColonizationLaunchError';
  }
}

export interface ColonizationLaunchInput {
  accountId: string;
  originPlanetId: string;
  targetSlot: unknown;
}

/** Safe internal acceptance data; no raw mission snapshots or queue details. */
export interface AcceptedColonizationLaunch {
  missionId: string;
  originPlanetId: string;
  target: { galaxy: number; system: number; slot: number };
  fuelHeliox: number;
  durationSeconds: number;
  departedAt: Date;
  arrivesAt: Date;
  status: 'OUTBOUND';
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}

function assertLaunchInput(input: ColonizationLaunchInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ColonizationLaunchError('INVALID_TARGET', 'The colonisation target is invalid.');
  }
  const allowed = new Set(['accountId', 'originPlanetId', 'targetSlot']);
  if (Object.keys(input).some((key) => !allowed.has(key))
    || typeof input.accountId !== 'string'
    || !input.accountId
    || typeof input.originPlanetId !== 'string'
    || !input.originPlanetId) {
    throw new ColonizationLaunchError('INVALID_TARGET', 'The colonisation target is invalid.');
  }
}

function planForOrigin(
  origin: { galaxy: number; system: number; slot: number },
  targetSlot: unknown,
  fleetSpeed: number,
): ColonizationPlan {
  try {
    return planSameSystemColonization({
      origin,
      targetSlot,
      ships: { colonyShip: 1 },
      fleetSpeed,
    });
  } catch {
    throw new ColonizationLaunchError('INVALID_TARGET', 'The colonisation target is invalid.');
  }
}

function starterStateSnapshot() {
  return {
    fieldCapacity: COLONY_STARTER_STATE.fieldCapacity,
    resources: { ...COLONY_STARTER_STATE.resources },
    buildings: { ...COLONY_STARTER_STATE.buildings },
  };
}

/**
 * Reserves exactly one Colony Ship and accepted Heliox for an internal-only,
 * same-system colonisation mission. PostgreSQL is authoritative; Stage 9B3
 * deliberately creates no Redis wake-up or player-visible side effect.
 */
export async function launchCanonicalColonization(
  input: ColonizationLaunchInput,
): Promise<AcceptedColonizationLaunch> {
  assertLaunchInput(input);
  const config = await getUniverseConfig();

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Canonical lock order: account → origin planet → origin Colony Ship
        // inventory → target coordinate advisory lock → FleetMission rows.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.accountId} FOR UPDATE`;
        const account = await tx.user.findUnique({
          where: { id: input.accountId },
          select: { id: true, status: true },
        });
        if (!account || account.status !== 'ACTIVE') {
          throw new ColonizationLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }

        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.originPlanetId} FOR UPDATE`;
        const origin = await tx.planet.findUnique({ where: { id: input.originPlanetId } });
        if (!origin || origin.ownerId !== account.id) {
          throw new ColonizationLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }

        const plan = planForOrigin(origin, input.targetSlot, config.fleetSpeed);
        const departedAt = new Date();
        const syncedOrigin = await syncLockedPlanetResources(tx, origin, departedAt, config.economySpeed);

        await tx.$queryRaw`
          SELECT "id" FROM "Ship"
          WHERE "planetId" = ${origin.id} AND "key" = 'colonyShip'
          FOR UPDATE
        `;
        const colonyShip = await tx.ship.findUnique({
          where: { planetId_key: { planetId: origin.id, key: 'colonyShip' } },
          select: { count: true },
        });

        await lockCoordinateForTransaction(tx, plan.target);

        await tx.$queryRaw`
          SELECT "id" FROM "FleetMission"
          WHERE "missionType" = 'COLONIZE'
            AND "status" = 'OUTBOUND'
            AND "colonizationAccountId" IS NOT NULL
            AND (
              "colonizationAccountId" = ${account.id}
              OR (
                "colonizationTargetGalaxy" = ${plan.target.galaxy}
                AND "colonizationTargetSystem" = ${plan.target.system}
                AND "colonizationTargetSlot" = ${plan.target.slot}
              )
            )
          FOR UPDATE
        `;

        const [targetPlanet, targetReservation, accountReservation, ownedPlanetCount, reservationCount] = await Promise.all([
          tx.planet.findUnique({
            where: { galaxy_system_slot: plan.target },
            select: { id: true },
          }),
          tx.fleetMission.findFirst({
            where: {
              missionType: 'COLONIZE',
              status: 'OUTBOUND',
              colonizationAccountId: { not: null },
              colonizationTargetGalaxy: plan.target.galaxy,
              colonizationTargetSystem: plan.target.system,
              colonizationTargetSlot: plan.target.slot,
            },
            select: { id: true },
          }),
          tx.fleetMission.findFirst({
            where: {
              missionType: 'COLONIZE',
              status: 'OUTBOUND',
              colonizationAccountId: account.id,
              colonizationTargetGalaxy: { not: null },
              colonizationTargetSystem: { not: null },
              colonizationTargetSlot: { not: null },
            },
            select: { id: true },
          }),
          tx.planet.count({ where: { ownerId: account.id } }),
          tx.fleetMission.count({
            where: {
              missionType: 'COLONIZE',
              status: 'OUTBOUND',
              colonizationAccountId: account.id,
              colonizationTargetGalaxy: { not: null },
              colonizationTargetSystem: { not: null },
              colonizationTargetSlot: { not: null },
            },
          }),
        ]);

        if (targetPlanet) {
          throw new ColonizationLaunchError('TARGET_OCCUPIED', 'The colonisation target is already occupied.');
        }
        if (targetReservation) {
          throw new ColonizationLaunchError('TARGET_RESERVED', 'The colonisation target is already reserved.');
        }
        if (ownedPlanetCount + reservationCount >= config.maxPlanetsPerPlayer) {
          throw new ColonizationLaunchError('PLANET_LIMIT_REACHED', 'The account has reached its planet limit.');
        }
        if (accountReservation) {
          throw new ColonizationLaunchError('COLONIZATION_IN_PROGRESS', 'A colonisation mission is already outbound for this account.');
        }
        if (!colonyShip || colonyShip.count < 1) {
          throw new ColonizationLaunchError('INSUFFICIENT_COLONY_SHIPS', 'The origin planet requires one available Colony Ship.');
        }
        if (syncedOrigin.planet.heliox < plan.fuelHeliox) {
          throw new ColonizationLaunchError('INSUFFICIENT_HELIOX', 'The origin planet does not have enough Heliox.');
        }

        const reservation = await tx.ship.updateMany({
          where: { planetId: origin.id, key: 'colonyShip', count: { gte: 1 } },
          data: { count: { decrement: 1 } },
        });
        if (reservation.count !== 1) {
          throw new ColonizationLaunchError('INSUFFICIENT_COLONY_SHIPS', 'The origin planet requires one available Colony Ship.');
        }
        await tx.planet.update({
          where: { id: origin.id },
          data: { heliox: syncedOrigin.planet.heliox - plan.fuelHeliox },
        });

        const missionId = randomUUID();
        const arrivesAt = new Date(departedAt.getTime() + plan.durationSeconds * 1_000);
        await tx.fleetMission.create({
          data: {
            id: missionId,
            originId: origin.id,
            targetId: null,
            targetGalaxy: plan.target.galaxy,
            targetSystem: plan.target.system,
            targetSlot: plan.target.slot,
            missionType: 'COLONIZE',
            ships: plan.ships,
            cargo: { alloy: 0, heliox: 0, aether: 0 },
            speedPercent: plan.speedPercent,
            departedAt,
            arrivesAt,
            status: 'OUTBOUND',
            colonizationAccountId: account.id,
            colonizationTargetGalaxy: plan.target.galaxy,
            colonizationTargetSystem: plan.target.system,
            colonizationTargetSlot: plan.target.slot,
            colonizationShips: plan.ships,
            colonizationFuelHeliox: plan.fuelHeliox,
            colonizationDurationSeconds: plan.durationSeconds,
            colonizationCharacteristics: deriveColonyCharacteristics(missionId),
            colonizationStarterState: starterStateSnapshot(),
          },
        });

        return {
          missionId,
          originPlanetId: origin.id,
          target: plan.target,
          fuelHeliox: plan.fuelHeliox,
          durationSeconds: plan.durationSeconds,
          departedAt,
          arrivesAt,
          status: 'OUTBOUND',
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ColonizationLaunchError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta?.target.join(' ') : String(error.meta?.target ?? '');
        if (target.includes('coordinate')) {
          throw new ColonizationLaunchError('TARGET_RESERVED', 'The colonisation target is already reserved.');
        }
        throw new ColonizationLaunchError('COLONIZATION_IN_PROGRESS', 'A colonisation mission is already outbound for this account.');
      }
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) {
        throw new ColonizationLaunchError('COLONIZATION_UNAVAILABLE', 'Colonisation launch could not be completed. Please try again.');
      }
      throw error;
    }
  }

  throw new ColonizationLaunchError('COLONIZATION_UNAVAILABLE', 'Colonisation launch could not be completed. Please try again.');
}

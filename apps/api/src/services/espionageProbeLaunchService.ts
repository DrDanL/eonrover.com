import { Prisma } from '@prisma/client';
import {
  GALAXY_COORDINATE_BOUNDS,
  EspionageProbePlan,
  planEspionageProbeMission,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type EspionageProbeLaunchErrorCode =
  | 'ORIGIN_NOT_OWNED'
  | 'INVALID_TARGET'
  | 'TARGET_UNAVAILABLE'
  | 'TARGET_PROTECTED'
  | 'MISSING_ESPIONAGE_TECHNOLOGY'
  | 'INSUFFICIENT_PROBES'
  | 'INSUFFICIENT_HELIOX'
  | 'ESPIONAGE_IN_PROGRESS'
  | 'ESPIONAGE_UNAVAILABLE';

/** Internal-only errors for a later, narrowly scoped Probe command API. */
export class EspionageProbeLaunchError extends Error {
  constructor(readonly code: EspionageProbeLaunchErrorCode, message: string) {
    super(message);
    this.name = 'EspionageProbeLaunchError';
  }
}

export interface EspionageProbeLaunchInput {
  userId: string;
  originPlanetId: string;
  target: unknown;
}

export interface AcceptedEspionageProbeLaunch {
  missionId: string;
  originPlanetId: string;
  target: { galaxy: number; system: number; slot: number };
  outboundFuelHeliox: number;
  returnFuelHeliox: number;
  outboundDurationSeconds: number;
  returnDurationSeconds: number;
  departedAt: Date;
  arrivesAt: Date;
  returnsAt: Date;
  phase: 'OUTBOUND';
}

type Coordinates = { galaxy: number; system: number; slot: number };

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}

function assertLaunchInput(input: EspionageProbeLaunchInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
  const allowed = new Set(['userId', 'originPlanetId', 'target']);
  if (
    Object.keys(input).some((key) => !allowed.has(key))
    || typeof input.userId !== 'string'
    || !input.userId
    || typeof input.originPlanetId !== 'string'
    || !input.originPlanetId
  ) {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
}

function parseTargetCoordinates(value: unknown): Coordinates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = ['galaxy', 'slot', 'system'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
  const { galaxy, system, slot } = candidate;
  if (
    typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
    || typeof system !== 'number' || !Number.isSafeInteger(system)
    || typeof slot !== 'number' || !Number.isSafeInteger(slot)
    || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max
    || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max
  ) {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
  return { galaxy, system, slot };
}

function planForPersistedPlanets(origin: Coordinates, target: Coordinates, fleetSpeed: number): EspionageProbePlan {
  try {
    return planEspionageProbeMission({ origin, target, fleetSpeed });
  } catch {
    throw new EspionageProbeLaunchError('INVALID_TARGET', 'The Probe target is invalid.');
  }
}

function isPublicTargetAccount(account: { status: string; emailVerifiedAt: Date | null }): boolean {
  return account.status === 'ACTIVE' && account.emailVerifiedAt !== null;
}

/**
 * Reserves one Probe and the accepted outbound plus return Heliox for a
 * future intelligence-only mission. It deliberately creates no Redis job,
 * report, notification, or target-side effect.
 */
export async function launchCanonicalEspionageProbe(
  input: EspionageProbeLaunchInput,
): Promise<AcceptedEspionageProbeLaunch> {
  assertLaunchInput(input);
  const targetCoordinates = parseTargetCoordinates(input.target);
  const config = await getUniverseConfig();

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Resolve only the coordinate-selected target before locks establish
        // the required sorted account → origin → target ordering. Its IDs are
        // never accepted from the caller or returned in an error.
        const targetCandidate = await tx.planet.findUnique({
          where: { galaxy_system_slot: targetCoordinates },
          select: { id: true, ownerId: true },
        });
        if (!targetCandidate) {
          throw new EspionageProbeLaunchError('TARGET_UNAVAILABLE', 'The Probe target is unavailable.');
        }

        const accountIds = [...new Set([input.userId, targetCandidate.ownerId])].sort();
        for (const accountId of accountIds) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${accountId} FOR UPDATE`;
        }
        const actor = await tx.user.findUnique({
          where: { id: input.userId },
          select: { id: true, status: true, emailVerifiedAt: true },
        });
        if (!actor || !isPublicTargetAccount(actor)) {
          throw new EspionageProbeLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }

        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.originPlanetId} FOR UPDATE`;
        const origin = await tx.planet.findUnique({ where: { id: input.originPlanetId } });
        if (!origin || origin.ownerId !== actor.id) {
          throw new EspionageProbeLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }

        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${targetCandidate.id} FOR UPDATE`;
        const target = await tx.planet.findUnique({
          where: { id: targetCandidate.id },
          include: { owner: { select: { id: true, status: true, emailVerifiedAt: true, protectedUntil: true } } },
        });
        if (
          !target
          || target.galaxy !== targetCoordinates.galaxy
          || target.system !== targetCoordinates.system
          || target.slot !== targetCoordinates.slot
          || target.ownerId !== targetCandidate.ownerId
        ) {
          throw new EspionageProbeLaunchError('TARGET_UNAVAILABLE', 'The Probe target is unavailable.');
        }

        const plan = planForPersistedPlanets(
          { galaxy: origin.galaxy, system: origin.system, slot: origin.slot },
          targetCoordinates,
          config.fleetSpeed,
        );
        const departedAt = new Date();
        if (target.ownerId === actor.id || !isPublicTargetAccount(target.owner)) {
          throw new EspionageProbeLaunchError('TARGET_UNAVAILABLE', 'The Probe target is unavailable.');
        }
        if (target.owner.protectedUntil && target.owner.protectedUntil > departedAt) {
          throw new EspionageProbeLaunchError('TARGET_PROTECTED', 'The Probe target is protected.');
        }

        const syncedOrigin = await syncLockedPlanetResources(tx, origin, departedAt, config.economySpeed);

        await tx.$queryRaw`
          SELECT "id" FROM "Ship"
          WHERE "planetId" = ${origin.id} AND "key" = 'probe'
          FOR UPDATE
        `;
        const probes = await tx.ship.findUnique({
          where: { planetId_key: { planetId: origin.id, key: 'probe' } },
          select: { count: true },
        });

        await tx.$queryRaw`
          SELECT "id" FROM "FleetMission"
          WHERE "missionType" = 'ESPIONAGE'
            AND "espionageOriginPlanetId" = ${origin.id}
            AND "espionageTargetPlanetId" IS NOT NULL
            AND "espionageOriginAccountId" IS NOT NULL
            AND "espionageTargetAccountId" IS NOT NULL
            AND "espionageProbePhase" IN ('OUTBOUND', 'RETURNING')
          FOR UPDATE
        `;
        const activeMission = await tx.fleetMission.findFirst({
          where: {
            missionType: 'ESPIONAGE',
            espionageOriginPlanetId: origin.id,
            espionageTargetPlanetId: { not: null },
            espionageOriginAccountId: { not: null },
            espionageTargetAccountId: { not: null },
            espionageProbePhase: { in: ['OUTBOUND', 'RETURNING'] },
          },
          select: { id: true },
        });
        if (activeMission) {
          throw new EspionageProbeLaunchError('ESPIONAGE_IN_PROGRESS', 'A Probe mission is already active from this planet.');
        }

        const technology = await tx.research.findUnique({
          where: { userId_key: { userId: actor.id, key: 'espionageTech' } },
          select: { level: true },
        });
        if (!technology || technology.level < 1) {
          throw new EspionageProbeLaunchError('MISSING_ESPIONAGE_TECHNOLOGY', 'Espionage Technology level 1 is required.');
        }
        if (!probes || probes.count < 1) {
          throw new EspionageProbeLaunchError('INSUFFICIENT_PROBES', 'The origin planet requires one available Probe.');
        }
        const totalFuelHeliox = plan.outboundFuelHeliox + plan.returnFuelHeliox;
        if (syncedOrigin.planet.heliox < totalFuelHeliox) {
          throw new EspionageProbeLaunchError('INSUFFICIENT_HELIOX', 'The origin planet does not have enough Heliox.');
        }

        const reservation = await tx.ship.updateMany({
          where: { planetId: origin.id, key: 'probe', count: { gte: 1 } },
          data: { count: { decrement: 1 } },
        });
        if (reservation.count !== 1) {
          throw new EspionageProbeLaunchError('INSUFFICIENT_PROBES', 'The origin planet requires one available Probe.');
        }
        await tx.planet.update({
          where: { id: origin.id },
          data: { heliox: syncedOrigin.planet.heliox - totalFuelHeliox },
        });

        const arrivesAt = new Date(departedAt.getTime() + plan.outboundDurationSeconds * 1_000);
        const returnsAt = new Date(arrivesAt.getTime() + plan.returnDurationSeconds * 1_000);
        const mission = await tx.fleetMission.create({
          data: {
            originId: origin.id,
            targetId: target.id,
            targetGalaxy: target.galaxy,
            targetSystem: target.system,
            targetSlot: target.slot,
            missionType: 'ESPIONAGE',
            ships: plan.ships,
            cargo: { alloy: 0, heliox: 0, aether: 0 },
            speedPercent: plan.speedPercent,
            departedAt,
            arrivesAt,
            returnsAt,
            status: 'OUTBOUND',
            espionageOriginPlanetId: origin.id,
            espionageTargetPlanetId: target.id,
            espionageOriginAccountId: actor.id,
            espionageTargetAccountId: target.ownerId,
            espionageProbeShips: plan.ships,
            espionageOutboundFuelHeliox: plan.outboundFuelHeliox,
            espionageReturnFuelHeliox: plan.returnFuelHeliox,
            espionageOutboundDurationSeconds: plan.outboundDurationSeconds,
            espionageReturnDurationSeconds: plan.returnDurationSeconds,
            espionageProbePhase: 'OUTBOUND',
          },
        });

        return {
          missionId: mission.id,
          originPlanetId: origin.id,
          target: targetCoordinates,
          outboundFuelHeliox: plan.outboundFuelHeliox,
          returnFuelHeliox: plan.returnFuelHeliox,
          outboundDurationSeconds: plan.outboundDurationSeconds,
          returnDurationSeconds: plan.returnDurationSeconds,
          departedAt,
          arrivesAt,
          returnsAt,
          phase: 'OUTBOUND' as const,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof EspionageProbeLaunchError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new EspionageProbeLaunchError('ESPIONAGE_IN_PROGRESS', 'A Probe mission is already active from this planet.');
      }
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) {
        throw new EspionageProbeLaunchError('ESPIONAGE_UNAVAILABLE', 'Probe launch could not be completed. Please try again.');
      }
      throw error;
    }
  }

  throw new EspionageProbeLaunchError('ESPIONAGE_UNAVAILABLE', 'Probe launch could not be completed. Please try again.');
}

import { Prisma } from '@prisma/client';
import { DeployPlan, planDeploy } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type DeployLaunchErrorCode =
  | 'ORIGIN_NOT_OWNED'
  | 'DESTINATION_NOT_OWNED'
  | 'IDENTICAL_PLANETS'
  | 'INVALID_DEPLOY_INPUT'
  | 'INSUFFICIENT_SHIPS'
  | 'INSUFFICIENT_HELIOX'
  | 'DEPLOYMENT_IN_PROGRESS'
  | 'DEPLOYMENT_UNAVAILABLE';

/**
 * Deliberately transport-agnostic errors for the future bounded Fleet API.
 * This internal service is currently exercised only by integration tests.
 */
export class DeployLaunchError extends Error {
  constructor(readonly code: DeployLaunchErrorCode, message: string) {
    super(message);
    this.name = 'DeployLaunchError';
  }
}

export interface DeployLaunchInput {
  accountId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  speedPercent: number;
  ships: unknown;
}

export interface AcceptedDeployLaunch {
  missionId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  ships: DeployPlan['ships'];
  fuelHeliox: number;
  durationSeconds: number;
  departedAt: Date;
  arrivesAt: Date;
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}

function assertLaunchInput(input: DeployLaunchInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DeployLaunchError('INVALID_DEPLOY_INPUT', 'Deploy launch input is invalid.');
  }
  const allowed = new Set(['accountId', 'originPlanetId', 'destinationPlanetId', 'speedPercent', 'ships']);
  if (Object.keys(input).some((key) => !allowed.has(key))
    || typeof input.accountId !== 'string'
    || !input.accountId
    || typeof input.originPlanetId !== 'string'
    || !input.originPlanetId
    || typeof input.destinationPlanetId !== 'string'
    || !input.destinationPlanetId) {
    throw new DeployLaunchError('INVALID_DEPLOY_INPUT', 'Deploy launch input is invalid.');
  }
}

function deployPlan(input: DeployLaunchInput, origin: { galaxy: number; system: number; slot: number }, destination: { galaxy: number; system: number; slot: number }, fleetSpeed: number): DeployPlan {
  try {
    return planDeploy({
      ships: input.ships,
      speedPercent: input.speedPercent,
      origin,
      destination,
      fleetSpeed,
    });
  } catch {
    throw new DeployLaunchError('INVALID_DEPLOY_INPUT', 'The deploy speed or ship manifest is invalid.');
  }
}

/**
 * Atomically reserves ships and one-way Heliox for a future owned-planet
 * DEPLOY mission. PostgreSQL is authoritative; this stage intentionally does
 * not schedule a worker wake-up or expose a public route.
 */
export async function launchOwnedPlanetDeploy(input: DeployLaunchInput): Promise<AcceptedDeployLaunch> {
  assertLaunchInput(input);
  const config = await getUniverseConfig();

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Canonical lock order: account → origin → destination → selected
        // origin inventory → fleet mission.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.accountId} FOR UPDATE`;
        const account = await tx.user.findUnique({ where: { id: input.accountId }, select: { id: true, status: true } });
        if (!account || account.status !== 'ACTIVE') {
          throw new DeployLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }
        if (input.originPlanetId === input.destinationPlanetId) {
          throw new DeployLaunchError('IDENTICAL_PLANETS', 'A deploy mission requires two distinct owned planets.');
        }

        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.originPlanetId} FOR UPDATE`;
        const origin = await tx.planet.findUnique({ where: { id: input.originPlanetId } });
        if (!origin || origin.ownerId !== account.id) {
          throw new DeployLaunchError('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
        }
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${input.destinationPlanetId} FOR UPDATE`;
        const destination = await tx.planet.findUnique({ where: { id: input.destinationPlanetId } });
        if (!destination || destination.ownerId !== account.id) {
          throw new DeployLaunchError('DESTINATION_NOT_OWNED', 'The destination planet is not available to this account.');
        }

        const plan = deployPlan(input, origin, destination, config.fleetSpeed);
        const departureTime = new Date();
        const syncedOrigin = await syncLockedPlanetResources(tx, origin, departureTime, config.economySpeed);

        const lockedInventory: Array<{ key: string; quantity: number; count: number | null }> = [];
        for (const [key, quantity] of Object.entries(plan.ships)) {
          await tx.$queryRaw`
            SELECT "id" FROM "Ship"
            WHERE "planetId" = ${origin.id} AND "key" = ${key}
            FOR UPDATE
          `;
          const inventory = await tx.ship.findUnique({ where: { planetId_key: { planetId: origin.id, key } } });
          lockedInventory.push({ key, quantity, count: inventory?.count ?? null });
        }

        await tx.$queryRaw`
          SELECT "id" FROM "FleetMission"
          WHERE "originId" = ${origin.id} AND "missionType" = 'DEPLOY' AND "status" = 'OUTBOUND'
          FOR UPDATE
        `;
        if (await tx.fleetMission.findFirst({
          where: { originId: origin.id, missionType: 'DEPLOY', status: 'OUTBOUND' },
          select: { id: true },
        })) {
          throw new DeployLaunchError('DEPLOYMENT_IN_PROGRESS', 'A deploy mission is already outbound from this planet.');
        }
        if (lockedInventory.some((inventory) => inventory.count === null || inventory.count < inventory.quantity)) {
          throw new DeployLaunchError('INSUFFICIENT_SHIPS', 'The origin planet does not have the required ships.');
        }
        if (syncedOrigin.planet.heliox < plan.fuelHeliox) {
          throw new DeployLaunchError('INSUFFICIENT_HELIOX', 'The origin planet does not have enough Heliox.');
        }

        for (const [key, quantity] of Object.entries(plan.ships)) {
          const reservation = await tx.ship.updateMany({
            where: { planetId: origin.id, key, count: { gte: quantity } },
            data: { count: { decrement: quantity } },
          });
          if (reservation.count !== 1) {
            throw new DeployLaunchError('INSUFFICIENT_SHIPS', 'The origin planet does not have the required ships.');
          }
        }
        await tx.planet.update({
          where: { id: origin.id },
          data: { heliox: syncedOrigin.planet.heliox - plan.fuelHeliox },
        });

        const arrivesAt = new Date(departureTime.getTime() + plan.durationSeconds * 1_000);
        const mission = await tx.fleetMission.create({
          data: {
            originId: origin.id,
            targetId: destination.id,
            targetGalaxy: destination.galaxy,
            targetSystem: destination.system,
            targetSlot: destination.slot,
            missionType: 'DEPLOY',
            ships: plan.ships,
            cargo: { alloy: 0, heliox: 0, aether: 0 },
            speedPercent: plan.speedPercent,
            departedAt: departureTime,
            arrivesAt,
            status: 'OUTBOUND',
            deployOriginId: origin.id,
            deployDestinationId: destination.id,
            deployShips: plan.ships,
            deployFuelHeliox: plan.fuelHeliox,
            deployDurationSeconds: plan.durationSeconds,
          },
        });

        return {
          missionId: mission.id,
          originPlanetId: origin.id,
          destinationPlanetId: destination.id,
          ships: plan.ships,
          fuelHeliox: plan.fuelHeliox,
          durationSeconds: plan.durationSeconds,
          departedAt: departureTime,
          arrivesAt,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof DeployLaunchError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DeployLaunchError('DEPLOYMENT_IN_PROGRESS', 'A deploy mission is already outbound from this planet.');
      }
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) {
        throw new DeployLaunchError('DEPLOYMENT_UNAVAILABLE', 'Deploy launch could not be completed. Please try again.');
      }
      throw error;
    }
  }

  throw new DeployLaunchError('DEPLOYMENT_UNAVAILABLE', 'Deploy launch could not be completed. Please try again.');
}

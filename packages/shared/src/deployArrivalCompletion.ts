import { canonicalDeployShips } from './deployMission';

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

/** The Prisma surface used by canonical deploy-arrival completion. */
export interface DeployArrivalCompletionDatabase {
  $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}

export type DeployArrivalCompletionOutcome = 'completed' | 'early' | 'noop' | 'unavailable';

function isRetryableTransactionError(error: any): boolean {
  return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}

function canonicalManifest(value: unknown) {
  try {
    return canonicalDeployShips(value);
  } catch {
    return null;
  }
}

/**
 * Completes only a persisted canonical owned-planet DEPLOY arrival. The
 * database is authoritative: callers supply only the mission id and a time
 * boundary. BullMQ payloads, legacy mission JSON, and job ids are never used
 * as game state.
 */
export async function completeOwnedPlanetDeployArrival(
  database: DeployArrivalCompletionDatabase,
  missionId: string,
  currentTime = new Date(),
): Promise<DeployArrivalCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(async (tx) => {
        // Canonical lock order: account → origin → destination → mission →
        // destination inventory. Candidate relations are all persisted.
        const accountLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT account."id" AS "id"
          FROM "User" AS account
          JOIN "Planet" AS origin ON origin."ownerId" = account."id"
          JOIN "FleetMission" AS mission ON mission."originId" = origin."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF account
        `;
        if (accountLocks.length !== 1) return 'noop';
        const account = await tx.user.findUnique({ where: { id: accountLocks[0].id }, select: { id: true } });
        if (!account) return 'noop';

        const originLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT origin."id" AS "id"
          FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."originId" = origin."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF origin
        `;
        if (originLocks.length !== 1) return 'noop';
        const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
        if (!origin) return 'noop';

        const destinationLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT destination."id" AS "id"
          FROM "Planet" AS destination
          JOIN "FleetMission" AS mission ON mission."deployDestinationId" = destination."id"
          WHERE mission."id" = ${missionId}
          FOR UPDATE OF destination
        `;
        if (destinationLocks.length !== 1) return 'noop';
        const destination = await tx.planet.findUnique({ where: { id: destinationLocks[0].id } });
        if (!destination) return 'noop';

        await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
        const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.missionType !== 'DEPLOY' || mission.status !== 'OUTBOUND') return 'noop';
        if (
          mission.deployOriginId !== origin.id
          || mission.deployDestinationId !== destination.id
          || mission.originId !== origin.id
          || mission.targetId !== destination.id
          || mission.targetGalaxy !== destination.galaxy
          || mission.targetSystem !== destination.system
          || mission.targetSlot !== destination.slot
          || origin.ownerId !== account.id
          || destination.ownerId !== account.id
          || !Number.isFinite(mission.arrivesAt.getTime())
        ) return 'noop';

        const ships = canonicalManifest(mission.deployShips);
        if (!ships) return 'noop';
        if (mission.arrivesAt > currentTime) return 'early';

        for (const key of Object.keys(ships)) {
          await tx.$queryRaw`
            SELECT "id" FROM "Ship"
            WHERE "planetId" = ${destination.id} AND "key" = ${key}
            FOR UPDATE
          `;
        }

        const transition = await tx.fleetMission.updateMany({
          where: { id: mission.id, status: 'OUTBOUND' },
          data: { status: 'COMPLETE' },
        });
        if (transition.count !== 1) return 'noop';
        for (const [key, quantity] of Object.entries(ships)) {
          await tx.ship.upsert({
            where: { planetId_key: { planetId: destination.id, key } },
            update: { count: { increment: quantity } },
            create: { planetId: destination.id, key, count: quantity },
          });
        }
        await tx.notification.create({
          data: {
            userId: account.id,
            type: 'FLEET_DEPLOY_COMPLETE',
            message: 'A deploy mission has arrived at its destination.',
          },
        });
        return 'completed';
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
      if (isRetryableTransactionError(error)) return 'unavailable';
      throw error;
    }
  }

  return 'unavailable';
}

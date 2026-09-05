import { Router } from 'express';
import { z } from 'zod';
import {
  BUILD_COMPLETION_JOB_NAME,
  BUILDINGS,
  BuildingKey,
  buildCompletionJobId,
  buildingCost,
  buildingDurationSeconds,
  storageCapacity,
} from '@eonrover/shared';
import type { BuildQueueItem } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncLockedPlanetResources, syncPlanetResources, withLockedPlanet } from '../services/planetService';
import { requirementsMet } from '../services/requirements';
import { buildQueue } from '../lib/redis';
import { AppError, asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';
import { getUniverseConfig } from '../services/gameConfig';
import { completeDueBuildingConstructionsForPlanet } from '../services/buildingCompletionService';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get<{ planetId: string }>('/', asyncHandler(async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  const currentTime = new Date();
  const synced = await syncPlanetResources(planet.id, currentTime);
  const levels = Object.fromEntries(synced.buildings.map((building) => [building.key, building.level]));
  const catalog = Object.values(BUILDINGS).map((def) => ({
    ...def,
    level: levels[def.key] ?? 0,
    nextCost: buildingCost(def.key, (levels[def.key] ?? 0) + 1),
  }));
  const pending = await prisma.buildQueueItem.findMany({ where: { planetId: planet.id, status: 'PENDING' } });
  res.json({
    catalog,
    queue: pending,
    planet: synced.planet,
    energy: synced.energy,
    production: synced.production,
    storage: {
      alloy: storageCapacity(levels.alloyStorage ?? 0),
      heliox: storageCapacity(levels.helioxStorage ?? 0),
      aether: storageCapacity(levels.aetherStorage ?? 0),
    },
  });
}));

const enqueueSchema = z.object({ key: z.string() });

export async function scheduleBuildCompletion(
  item: Pick<BuildQueueItem, 'id' | 'completesAt'>,
): Promise<string | null> {
  const jobId = buildCompletionJobId(item.id);
  try {
    await buildQueue.add(
      BUILD_COMPLETION_JOB_NAME,
      { queueItemId: item.id },
      {
        jobId,
        delay: Math.max(0, item.completesAt.getTime() - Date.now()),
        removeOnComplete: true,
        attempts: 3,
      },
    );
    await prisma.buildQueueItem.updateMany({
      where: { id: item.id, status: 'PENDING' },
      data: { jobId },
    });
    return jobId;
  } catch {
    // The durable database row remains authoritative; worker reconciliation
    // will restore this deterministic job from PostgreSQL.
    return null;
  }
}

router.post<{ planetId: string }>('/', asyncHandler(async (req, res) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const requestedKey = parsed.data.key;
  const startedAt = new Date();
  const owned = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!owned) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  await completeDueBuildingConstructionsForPlanet(owned.id, startedAt);
  const config = await getUniverseConfig();
  const ownerId = req.user!.id;

  const outcome = await withLockedPlanet(req.params.planetId, async (tx, lockedPlanet) => {
    if (lockedPlanet.ownerId !== ownerId) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    }

    const synced = await syncLockedPlanetResources(tx, lockedPlanet, startedAt, config.economySpeed);
    const pending = await tx.buildQueueItem.findFirst({
      where: { planetId: lockedPlanet.id, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) return { kind: 'in-progress' as const };
    if (!(requestedKey in BUILDINGS)) return { kind: 'unknown-building' as const };

    const key = requestedKey as BuildingKey;

    const buildingLevels = Object.fromEntries(synced.buildings.map((building) => [building.key, building.level]));
    const research = await tx.research.findMany({ where: { userId: ownerId } });
    const researchLevels = Object.fromEntries(research.map((item) => [item.key, item.level]));
    const targetLevel = (buildingLevels[key] ?? 0) + 1;
    const definition = BUILDINGS[key];
    if (!requirementsMet(definition.requires, buildingLevels, researchLevels)) {
      return { kind: 'requirements' as const };
    }

    const cost = buildingCost(key, targetLevel);
    if (
      synced.planet.alloy < cost.alloy ||
      synced.planet.heliox < cost.heliox ||
      synced.planet.aether < cost.aether
    ) {
      return { kind: 'insufficient' as const, cost };
    }

    const durationSeconds = buildingDurationSeconds(
      cost,
      buildingLevels.researchLab ?? 0,
      config.economySpeed,
    );
    const completesAt = new Date(startedAt.getTime() + durationSeconds * 1000);

    await tx.planet.update({
      where: { id: lockedPlanet.id },
      data: {
        alloy: synced.planet.alloy - cost.alloy,
        heliox: synced.planet.heliox - cost.heliox,
        aether: synced.planet.aether - cost.aether,
      },
    });
    const item = await tx.buildQueueItem.create({
      data: {
        planetId: lockedPlanet.id,
        buildingKey: key,
        targetLevel,
        costAlloy: cost.alloy,
        costHeliox: cost.heliox,
        costAether: cost.aether,
        startedAt,
        completesAt,
      },
    });
    return { kind: 'accepted' as const, item };
  });

  if (outcome.kind === 'unknown-building') {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Unknown building');
    return;
  }
  if (outcome.kind === 'in-progress') {
    sendError(
      res,
      409,
      ERROR_CODES.CONSTRUCTION_IN_PROGRESS,
      'A building upgrade is already in progress on this planet.',
    );
    return;
  }
  if (outcome.kind === 'requirements') {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Requirements not met');
    return;
  }
  if (outcome.kind === 'insufficient') {
    sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources', { cost: outcome.cost });
    return;
  }

  const scheduledJobId = await scheduleBuildCompletion(outcome.item);
  res.status(201).json({
    queueItem: scheduledJobId ? { ...outcome.item, jobId: scheduledJobId } : outcome.item,
  });
}));

router.delete<{ planetId: string; queueItemId: string }>('/:queueItemId', asyncHandler(async (req, res) => {
  const cancelledAt = new Date();
  const owned = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!owned) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  await completeDueBuildingConstructionsForPlanet(owned.id, cancelledAt);
  const config = await getUniverseConfig();
  const ownerId = req.user!.id;
  const queueItemId = req.params.queueItemId;

  const outcome = await withLockedPlanet(req.params.planetId, async (tx, lockedPlanet) => {
    if (lockedPlanet.ownerId !== ownerId) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    }

    await tx.$queryRaw`
      SELECT "id"
      FROM "BuildQueueItem"
      WHERE "id" = ${queueItemId} AND "planetId" = ${lockedPlanet.id}
      FOR UPDATE
    `;
    const item = await tx.buildQueueItem.findFirst({
      where: { id: queueItemId, planetId: lockedPlanet.id },
    });
    const synced = await syncLockedPlanetResources(tx, lockedPlanet, cancelledAt, config.economySpeed);
    if (!item) return { kind: 'not-found' as const };
    if (item.status !== 'PENDING') return { kind: 'not-cancellable' as const };

    const transitioned = await tx.buildQueueItem.updateMany({
      where: { id: item.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (transitioned.count !== 1) return { kind: 'not-cancellable' as const };

    await tx.planet.update({
      where: { id: lockedPlanet.id },
      data: {
        alloy: synced.planet.alloy + Math.round(item.costAlloy * 0.5),
        heliox: synced.planet.heliox + Math.round(item.costHeliox * 0.5),
        aether: synced.planet.aether + Math.round(item.costAether * 0.5),
      },
    });
    return { kind: 'cancelled' as const, item };
  });

  if (outcome.kind === 'not-found') {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Queue item not found');
    return;
  }
  if (outcome.kind === 'not-cancellable') {
    sendError(
      res,
      409,
      ERROR_CODES.CONSTRUCTION_NOT_CANCELLABLE,
      'This building upgrade can no longer be cancelled.',
    );
    return;
  }

  try {
    const job = await buildQueue.getJob(outcome.item.jobId ?? buildCompletionJobId(outcome.item.id));
    await job?.remove();
  } catch {
    // Cancellation is committed in PostgreSQL; Redis cleanup is best-effort.
  }
  res.json({ message: 'Cancelled, 50% of resources refunded' });
}));

export default router;

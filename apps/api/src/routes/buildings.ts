import { Router } from 'express';
import { z } from 'zod';
import { BUILDINGS, BuildingKey, buildingCost, buildingDurationSeconds } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getBuildingLevels, getResearchLevels, requirementsMet } from '../services/requirements';
import { buildQueue } from '../lib/redis';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get<{ planetId: string }>('/', async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const levels = await getBuildingLevels(planet.id);
  const catalog = Object.values(BUILDINGS).map((def) => ({
    ...def,
    level: levels[def.key] ?? 0,
    nextCost: buildingCost(def.key, (levels[def.key] ?? 0) + 1),
  }));
  const pending = await prisma.buildQueueItem.findMany({ where: { planetId: planet.id, status: 'PENDING' } });
  res.json({ catalog, queue: pending });
});

const enqueueSchema = z.object({ key: z.string() });

router.post<{ planetId: string }>('/', async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success || !(parsed.data.key in BUILDINGS)) {
    res.status(400).json({ error: 'Unknown building' });
    return;
  }
  const key = parsed.data.key as BuildingKey;

  const existingQueueCount = await prisma.buildQueueItem.count({
    where: { planetId: planet.id, status: 'PENDING' },
  });
  if (existingQueueCount >= 5) {
    res.status(409).json({ error: 'Build queue is full' });
    return;
  }

  const [buildingLevels, researchLevels] = await Promise.all([
    getBuildingLevels(planet.id),
    getResearchLevels(req.user!.id),
  ]);
  const currentLevel = buildingLevels[key] ?? 0;
  const targetLevel = currentLevel + existingQueueCount + 1;
  const def = BUILDINGS[key];
  if (!requirementsMet(def.requires, buildingLevels, researchLevels)) {
    res.status(409).json({ error: 'Requirements not met' });
    return;
  }

  const cost = buildingCost(key, targetLevel);
  const { planet: fresh } = await syncPlanetResources(planet.id);
  if (fresh.alloy < cost.alloy || fresh.heliox < cost.heliox || fresh.aether < cost.aether) {
    res.status(402).json({ error: 'Insufficient resources', cost });
    return;
  }

  const researchLabLevel = buildingLevels.researchLab ?? 0;
  const config = await import('../services/gameConfig').then((m) => m.getUniverseConfig());
  const durationSeconds = buildingDurationSeconds(cost, researchLabLevel, config.economySpeed);

  const lastQueueItem = await prisma.buildQueueItem.findFirst({
    where: { planetId: planet.id, status: 'PENDING' },
    orderBy: { completesAt: 'desc' },
  });
  const startedAt = lastQueueItem ? lastQueueItem.completesAt : new Date();
  const completesAt = new Date(startedAt.getTime() + durationSeconds * 1000);

  const result = await prisma.$transaction(async (tx) => {
    await tx.planet.update({
      where: { id: planet.id },
      data: { alloy: { decrement: cost.alloy }, heliox: { decrement: cost.heliox }, aether: { decrement: cost.aether } },
    });
    return tx.buildQueueItem.create({
      data: { planetId: planet.id, buildingKey: key, targetLevel, startedAt, completesAt },
    });
  });

  const delay = Math.max(0, completesAt.getTime() - Date.now());
  const job = await buildQueue.add(
    'complete-building',
    { queueItemId: result.id },
    { delay, removeOnComplete: true, attempts: 3 },
  );
  await prisma.buildQueueItem.update({ where: { id: result.id }, data: { jobId: job.id } });

  res.status(201).json({ queueItem: { ...result, jobId: job.id } });
});

router.delete<{ planetId: string; queueItemId: string }>('/:queueItemId', async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const item = await prisma.buildQueueItem.findUnique({ where: { id: req.params.queueItemId } });
  if (!item || item.planetId !== planet.id || item.status !== 'PENDING') {
    res.status(404).json({ error: 'Queue item not found' });
    return;
  }
  const def = BUILDINGS[item.buildingKey as BuildingKey];
  const cost = buildingCost(item.buildingKey as BuildingKey, item.targetLevel);
  void def;
  await prisma.$transaction(async (tx) => {
    await tx.buildQueueItem.update({ where: { id: item.id }, data: { status: 'CANCELLED' } });
    await tx.planet.update({
      where: { id: planet.id },
      data: {
        alloy: { increment: Math.round(cost.alloy * 0.5) },
        heliox: { increment: Math.round(cost.heliox * 0.5) },
        aether: { increment: Math.round(cost.aether * 0.5) },
      },
    });
  });
  if (item.jobId) {
    const job = await buildQueue.getJob(item.jobId);
    await job?.remove().catch(() => undefined);
  }
  res.json({ message: 'Cancelled, 50% of resources refunded' });
});

export default router;

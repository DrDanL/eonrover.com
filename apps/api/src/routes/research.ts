import { Router } from 'express';
import { z } from 'zod';
import { RESEARCH, ResearchKey, researchCost, researchDurationSeconds } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getBuildingLevels, getResearchLevels, requirementsMet } from '../services/requirements';
import { researchQueue } from '../lib/redis';
import { getUniverseConfig } from '../services/gameConfig';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get('/', async (req, res) => {
  const levels = await getResearchLevels(req.user!.id);
  const catalog = Object.values(RESEARCH).map((def) => ({
    ...def,
    level: levels[def.key] ?? 0,
    nextCost: researchCost(def.key, (levels[def.key] ?? 0) + 1),
  }));
  const pending = await prisma.researchQueueItem.findMany({
    where: { planet: { ownerId: req.user!.id }, status: 'PENDING' },
  });
  res.json({ catalog, queue: pending });
});

const enqueueSchema = z.object({ key: z.string(), planetId: z.string() });

router.post('/', async (req, res) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success || !(parsed.data.key in RESEARCH)) {
    res.status(400).json({ error: 'Unknown research' });
    return;
  }
  const planet = await assertOwnedPlanet(parsed.data.planetId, req.user!.id);
  if (!planet) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const key = parsed.data.key as ResearchKey;

  const alreadyQueued = await prisma.researchQueueItem.findFirst({
    where: { planet: { ownerId: req.user!.id }, status: 'PENDING' },
  });
  if (alreadyQueued) {
    res.status(409).json({ error: 'Only one research can be active at a time' });
    return;
  }

  const [buildingLevels, researchLevels] = await Promise.all([
    getBuildingLevels(planet.id),
    getResearchLevels(req.user!.id),
  ]);
  const def = RESEARCH[key];
  if (!requirementsMet(def.requires, buildingLevels, researchLevels)) {
    res.status(409).json({ error: 'Requirements not met' });
    return;
  }
  const targetLevel = (researchLevels[key] ?? 0) + 1;
  const cost = researchCost(key, targetLevel);

  const { planet: fresh } = await syncPlanetResources(planet.id);
  if (fresh.alloy < cost.alloy || fresh.heliox < cost.heliox || fresh.aether < cost.aether) {
    res.status(402).json({ error: 'Insufficient resources', cost });
    return;
  }

  const config = await getUniverseConfig();
  const durationSeconds = researchDurationSeconds(cost, buildingLevels.researchLab ?? 0, config.researchSpeed);
  const completesAt = new Date(Date.now() + durationSeconds * 1000);

  const result = await prisma.$transaction(async (tx) => {
    await tx.planet.update({
      where: { id: planet.id },
      data: { alloy: { decrement: cost.alloy }, heliox: { decrement: cost.heliox }, aether: { decrement: cost.aether } },
    });
    return tx.researchQueueItem.create({
      data: { planetId: planet.id, researchKey: key, targetLevel, completesAt },
    });
  });

  const delay = Math.max(0, completesAt.getTime() - Date.now());
  const job = await researchQueue.add(
    'complete-research',
    { queueItemId: result.id, userId: req.user!.id },
    { delay, removeOnComplete: true, attempts: 3 },
  );
  await prisma.researchQueueItem.update({ where: { id: result.id }, data: { jobId: job.id } });

  res.status(201).json({ queueItem: { ...result, jobId: job.id } });
});

export default router;

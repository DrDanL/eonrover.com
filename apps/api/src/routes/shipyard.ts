import { Router } from 'express';
import { z } from 'zod';
import { DEFENCES, DefenceKey, SHIPS, ShipKey, shipyardDurationSeconds } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getBuildingLevels, getResearchLevels, requirementsMet } from '../services/requirements';
import { shipyardQueue } from '../lib/redis';
import { getUniverseConfig } from '../services/gameConfig';

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
  const [ships, defences, queue] = await Promise.all([
    prisma.ship.findMany({ where: { planetId: planet.id } }),
    prisma.defence.findMany({ where: { planetId: planet.id } }),
    prisma.shipyardQueueItem.findMany({ where: { planetId: planet.id, status: 'PENDING' } }),
  ]);
  res.json({
    ships: Object.values(SHIPS).map((def) => ({
      ...def,
      owned: ships.find((s) => s.key === def.key)?.count ?? 0,
    })),
    defences: Object.values(DEFENCES).map((def) => ({
      ...def,
      owned: defences.find((d) => d.key === def.key)?.count ?? 0,
    })),
    queue,
  });
});

const enqueueSchema = z.object({
  itemKey: z.string(),
  itemType: z.enum(['ship', 'defence']),
  quantity: z.number().int().min(1).max(500),
});

router.post<{ planetId: string }>('/', async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const { itemKey, itemType, quantity } = parsed.data;
  const def =
    itemType === 'ship'
      ? (itemKey in SHIPS ? SHIPS[itemKey as ShipKey] : undefined)
      : (itemKey in DEFENCES ? DEFENCES[itemKey as DefenceKey] : undefined);
  if (!def) {
    res.status(400).json({ error: 'Unknown item' });
    return;
  }

  const [buildingLevels, researchLevels] = await Promise.all([
    getBuildingLevels(planet.id),
    getResearchLevels(req.user!.id),
  ]);
  if (!requirementsMet(def.requires, buildingLevels, researchLevels)) {
    res.status(409).json({ error: 'Requirements not met' });
    return;
  }

  const totalCost = {
    alloy: def.cost.alloy * quantity,
    heliox: def.cost.heliox * quantity,
    aether: def.cost.aether * quantity,
  };
  const { planet: fresh } = await syncPlanetResources(planet.id);
  if (fresh.alloy < totalCost.alloy || fresh.heliox < totalCost.heliox || fresh.aether < totalCost.aether) {
    res.status(402).json({ error: 'Insufficient resources', cost: totalCost });
    return;
  }

  const config = await getUniverseConfig();
  const perUnitSeconds = shipyardDurationSeconds(
    def.buildTimeSeconds,
    buildingLevels.shipyard ?? 0,
    config.economySpeed,
  );
  const completesAt = new Date(Date.now() + perUnitSeconds * 1000);

  const result = await prisma.$transaction(async (tx) => {
    await tx.planet.update({
      where: { id: planet.id },
      data: {
        alloy: { decrement: totalCost.alloy },
        heliox: { decrement: totalCost.heliox },
        aether: { decrement: totalCost.aether },
      },
    });
    return tx.shipyardQueueItem.create({
      data: { planetId: planet.id, itemKey, itemType, quantity, remaining: quantity, completesAt },
    });
  });

  const delay = Math.max(0, completesAt.getTime() - Date.now());
  const job = await shipyardQueue.add(
    'complete-shipyard-unit',
    { queueItemId: result.id, perUnitSeconds },
    { delay, removeOnComplete: true, attempts: 3 },
  );
  await prisma.shipyardQueueItem.update({ where: { id: result.id }, data: { jobId: job.id } });

  res.status(201).json({ queueItem: { ...result, jobId: job.id } });
});

export default router;

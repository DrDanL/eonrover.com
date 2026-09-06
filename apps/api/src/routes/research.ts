import { Router } from 'express';
import { z } from 'zod';
import {
  BUILDINGS,
  RESEARCH_BY_ID,
  RESEARCH_CATALOGUE,
  RESEARCH_CATEGORIES,
  ResearchKey,
  evaluateResearchEntry,
  researchCost,
  researchDurationSeconds,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getBuildingLevels, getResearchLevels, requirementsMet } from '../services/requirements';
import { researchQueue } from '../lib/redis';
import { getUniverseConfig } from '../services/gameConfig';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get('/', asyncHandler(async (req, res) => {
  const planetId = typeof req.query.planetId === 'string' ? req.query.planetId : '';
  const selectedPlanet = await assertOwnedPlanet(planetId, req.user!.id);
  if (!selectedPlanet) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }

  // This is a presentation read: it may settle overdue building work and the
  // selected planet's timestamp-based resources, but never changes research.
  const [{ planet, buildings }, persistedResearch, config, pending] = await Promise.all([
    syncPlanetResources(selectedPlanet.id),
    prisma.research.findMany({ where: { userId: req.user!.id } }),
    getUniverseConfig(),
    prisma.researchQueueItem.findMany({
      where: { planet: { ownerId: req.user!.id }, status: 'PENDING' },
      orderBy: { startedAt: 'asc' },
      take: 1,
    }),
  ]);
  const accountResearchLevels = Object.fromEntries(
    persistedResearch
      .filter((row) => row.key in RESEARCH_BY_ID)
      .map((row) => [row.key, Number.isFinite(row.level) ? Math.max(0, Math.floor(row.level)) : 0]),
  );
  const planetBuildingLevels = Object.fromEntries(buildings.map((building) => [building.key, building.level]));
  const resources = { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether };
  const catalog = RESEARCH_CATALOGUE.map((entry) => {
    const evaluation = evaluateResearchEntry({
      id: entry.id,
      currentLevel: accountResearchLevels[entry.id] ?? 0,
      accountResearchLevels,
      planetBuildingLevels,
      researchSpeed: config.researchSpeed,
    });
    const requirements = evaluation.requirements.map((requirement) => ({
      type: requirement.kind,
      id: requirement.id,
      name: requirement.kind === 'building' ? BUILDINGS[requirement.id].name : RESEARCH_BY_ID[requirement.id].name,
      requiredLevel: requirement.level,
      currentLevel: requirement.currentLevel,
      met: requirement.met,
    }));
    const affordable = resources.alloy >= evaluation.cost.alloy && resources.heliox >= evaluation.cost.heliox && resources.aether >= evaluation.cost.aether;
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      displayOrder: entry.displayOrder,
      currentLevel: evaluation.currentLevel,
      nextLevel: evaluation.nextLevel,
      cost: evaluation.cost,
      durationSeconds: evaluation.durationSeconds,
      requirements,
      unmetRequirements: requirements.filter((requirement) => !requirement.met),
      meetsRequirements: evaluation.meetsRequirements,
      affordable,
      effect: entry.effect,
      scheduling: { available: false, reason: 'Research scheduling is currently unavailable.' },
    };
  });
  const active = pending[0];
  res.json({
    generatedAt: new Date().toISOString(),
    selectedPlanet: {
      id: planet.id,
      name: planet.name,
      researchLabLevel: planetBuildingLevels.researchLab ?? 0,
      resources,
    },
    accountResearchLevels,
    categories: RESEARCH_CATEGORIES,
    catalog,
    activeResearch: active
      ? {
          id: active.researchKey,
          name: RESEARCH_BY_ID[active.researchKey as ResearchKey]?.name ?? active.researchKey,
          targetLevel: active.targetLevel,
          startedAt: active.startedAt,
          completesAt: active.completesAt,
          status: active.status,
        }
      : null,
  });
}));

const enqueueSchema = z.object({ key: z.string(), planetId: z.string() });

router.post('/', asyncHandler(async (req, res) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  if (!(parsed.data.key in RESEARCH_BY_ID)) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Unknown research');
    return;
  }
  const planet = await assertOwnedPlanet(parsed.data.planetId, req.user!.id);
  if (!planet) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  const key = parsed.data.key as ResearchKey;

  const alreadyQueued = await prisma.researchQueueItem.findFirst({
    where: { planet: { ownerId: req.user!.id }, status: 'PENDING' },
  });
  if (alreadyQueued) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Only one research can be active at a time');
    return;
  }

  const [buildingLevels, researchLevels] = await Promise.all([
    getBuildingLevels(planet.id),
    getResearchLevels(req.user!.id),
  ]);
  const def = RESEARCH_BY_ID[key];
  const legacyRequirements = Object.fromEntries(def.requirements.map((requirement) => [requirement.id, requirement.level]));
  if (!requirementsMet(legacyRequirements, buildingLevels, researchLevels)) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Requirements not met');
    return;
  }
  const targetLevel = (researchLevels[key] ?? 0) + 1;
  const cost = researchCost(key, targetLevel);

  const { planet: fresh } = await syncPlanetResources(planet.id);
  if (fresh.alloy < cost.alloy || fresh.heliox < cost.heliox || fresh.aether < cost.aether) {
    sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources', { cost });
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
}));

export default router;

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
import { syncLockedPlanetResources, syncPlanetResources } from '../services/planetService';
import { getResearchLevels } from '../services/requirements';
import { researchQueue } from '../lib/redis';
import { getUniverseConfig } from '../services/gameConfig';
import { AppError, asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';
import { Prisma } from '@prisma/client';

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
const START_TRANSACTION_ATTEMPTS = 3;

function presentRequirements(key: ResearchKey, research: Record<string, number>, buildings: Record<string, number>) {
  return RESEARCH_BY_ID[key].requirements.map((requirement) => {
    const currentLevel = requirement.kind === 'building' ? (buildings[requirement.id] ?? 0) : (research[requirement.id] ?? 0);
    return { type: requirement.kind, id: requirement.id, name: requirement.kind === 'building' ? BUILDINGS[requirement.id].name : RESEARCH_BY_ID[requirement.id].name, requiredLevel: requirement.level, currentLevel, met: currentLevel >= requirement.level };
  });
}

function presentQueueItem(item: { id: string; researchKey: string; targetLevel: number; costAlloy: number; costHeliox: number; costAether: number; durationSeconds: number; startedAt: Date; completesAt: Date; status: string; planet: { id: string; name: string } }) {
  return { id: item.id, technologyId: item.researchKey, technologyName: RESEARCH_BY_ID[item.researchKey as ResearchKey]?.name ?? item.researchKey, originatingPlanet: item.planet, targetLevel: item.targetLevel, cost: { alloy: item.costAlloy, heliox: item.costHeliox, aether: item.costAether }, durationSeconds: item.durationSeconds, startedAt: item.startedAt, completesAt: item.completesAt, status: item.status };
}

async function scheduleResearchCompletion(item: { id: string; userId: string; completesAt: Date }): Promise<boolean> {
  const jobId = `research-${item.id}`;
  try {
    await researchQueue.add('complete-research', { queueItemId: item.id, userId: item.userId }, { jobId, delay: Math.max(0, item.completesAt.getTime() - Date.now()), removeOnComplete: true, attempts: 3 });
    await prisma.researchQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { jobId } });
    return true;
  } catch {
    return false;
  }
}

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
  const key = parsed.data.key as ResearchKey;
  const config = await getUniverseConfig();
  const startedAt = new Date();
  let accepted: Awaited<ReturnType<typeof prisma.researchQueueItem.create>> | null = null;
  for (let attempt = 0; attempt < START_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      accepted = await prisma.$transaction(async (tx) => {
        // Lock order: account, selected planet, completed research, queue row.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.user!.id} FOR UPDATE`;
        const account = await tx.user.findUnique({ where: { id: req.user!.id } });
        if (!account || account.status !== 'ACTIVE') throw new AppError(403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${parsed.data.planetId} FOR UPDATE`;
        const planet = await tx.planet.findUnique({ where: { id: parsed.data.planetId } });
        if (!planet || planet.ownerId !== account.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Planet not found');
        const active = await tx.researchQueueItem.findFirst({ where: { userId: account.id, status: 'PENDING' }, select: { id: true } });
        if (active) throw new AppError(409, ERROR_CODES.RESEARCH_IN_PROGRESS, 'Another research item is already active.');
        const rows = await tx.research.findMany({ where: { userId: account.id } });
        const researchLevels = Object.fromEntries(rows.map((row) => [row.key, row.level]));
        const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
        const buildingLevels = Object.fromEntries(buildings.map((row) => [row.key, row.level]));
        const requirements = presentRequirements(key, researchLevels, buildingLevels);
        const unmet = requirements.filter((requirement) => !requirement.met);
        if (unmet.length) throw new AppError(409, ERROR_CODES.RESEARCH_REQUIREMENTS_NOT_MET, 'Research requirements have not been met.', { requirements: unmet });
        if (RESEARCH_BY_ID[key].effect.status === 'PLANNED') throw new AppError(409, ERROR_CODES.RESEARCH_EFFECT_UNAVAILABLE, 'This technology is not yet available for research.');
        const synced = await syncLockedPlanetResources(tx, planet, startedAt, config.economySpeed);
        const targetLevel = (researchLevels[key] ?? 0) + 1;
        const cost = researchCost(key, targetLevel);
        if (synced.planet.alloy < cost.alloy || synced.planet.heliox < cost.heliox || synced.planet.aether < cost.aether) throw new AppError(402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources', { cost });
        const durationSeconds = researchDurationSeconds(cost, buildingLevels.researchLab ?? 0, config.researchSpeed);
        const completesAt = new Date(startedAt.getTime() + durationSeconds * 1000);
        await tx.planet.update({ where: { id: planet.id }, data: { alloy: synced.planet.alloy - cost.alloy, heliox: synced.planet.heliox - cost.heliox, aether: synced.planet.aether - cost.aether } });
        return tx.researchQueueItem.create({ data: { userId: account.id, planetId: planet.id, researchKey: key, targetLevel, costAlloy: cost.alloy, costHeliox: cost.heliox, costAether: cost.aether, durationSeconds, startedAt, completesAt } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt + 1 < START_TRANSACTION_ATTEMPTS) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, ERROR_CODES.RESEARCH_IN_PROGRESS, 'Another research item is already active.');
      }
      throw error;
    }
  }
  if (!accepted) throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Research could not be started. Please try again.');
  const scheduled = await scheduleResearchCompletion(accepted);
  const queue = await prisma.researchQueueItem.findUniqueOrThrow({ where: { id: accepted.id }, include: { planet: { select: { id: true, name: true } } } });
  res.status(201).json({ queueItem: presentQueueItem(queue), scheduling: scheduled ? 'scheduled' : 'pending' });
}));

router.delete('/:queueItemId', asyncHandler(async (req, res) => {
  const now = new Date();
  const configForCancel = await getUniverseConfig();
  const initial = await prisma.researchQueueItem.findUnique({ where: { id: req.params.queueItemId }, select: { planetId: true } });
  if (!initial) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Research not found'); return; }
  const cancelled = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.user!.id} FOR UPDATE`;
    const account = await tx.user.findUnique({ where: { id: req.user!.id } });
    if (!account || account.status !== 'ACTIVE') throw new AppError(403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
    await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${initial.planetId} FOR UPDATE`;
    const planet = await tx.planet.findUnique({ where: { id: initial.planetId } });
    await tx.$queryRaw`SELECT "id" FROM "ResearchQueueItem" WHERE "id" = ${req.params.queueItemId} FOR UPDATE`;
    const item = await tx.researchQueueItem.findUnique({ where: { id: req.params.queueItemId } });
    if (!item || !planet || item.userId !== account.id || planet.ownerId !== account.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Research not found');
    if (item.status !== 'PENDING' || item.completesAt <= now) throw new AppError(409, ERROR_CODES.RESEARCH_NOT_CANCELLABLE, 'This research item can no longer be cancelled.');
    const synced = await syncLockedPlanetResources(tx, planet, now, configForCancel.economySpeed);
    const refund = { alloy: Math.round(item.costAlloy * 0.5), heliox: Math.round(item.costHeliox * 0.5), aether: Math.round(item.costAether * 0.5) };
    const updated = await tx.researchQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (updated.count !== 1) throw new AppError(409, ERROR_CODES.RESEARCH_NOT_CANCELLABLE, 'This research item can no longer be cancelled.');
    await tx.planet.update({ where: { id: planet.id }, data: { alloy: synced.planet.alloy + refund.alloy, heliox: synced.planet.heliox + refund.heliox, aether: synced.planet.aether + refund.aether } });
    return { item, refund };
  });
  try { await researchQueue.remove(`research-${cancelled.item.id}`); } catch { /* PostgreSQL cancellation remains authoritative. */ }
  res.json({ queueItem: { id: cancelled.item.id, status: 'CANCELLED' }, refund: cancelled.refund });
}));

export default router;

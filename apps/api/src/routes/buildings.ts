import { Router } from 'express';
import { z } from 'zod';
import {
  BUILD_COMPLETION_JOB_NAME,
  BUILDING_CATEGORIES,
  BUILDINGS,
  BuildingKey,
  buildCompletionJobId,
  buildingCost,
  buildingDurationSeconds,
  buildingEnergy,
  evaluateBuildingPrerequisites,
  hourlyProduction,
  planetProductionMultiplier,
  projectBuildingEnergy,
  storageCapacity,
} from '@eonrover/shared';
import type { BuildQueueItem } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import {
  PLANET_TYPE_DB_TO_SHARED,
  syncLockedPlanetResources,
  syncPlanetResources,
  withLockedPlanet,
} from '../services/planetService';
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

function presentQueueItem(item: BuildQueueItem) {
  return {
    id: item.id,
    buildingKey: item.buildingKey,
    buildingName: BUILDINGS[item.buildingKey as BuildingKey]?.name ?? item.buildingKey,
    targetLevel: item.targetLevel,
    costAlloy: item.costAlloy,
    costHeliox: item.costHeliox,
    costAether: item.costAether,
    startedAt: item.startedAt,
    completesAt: item.completesAt,
    status: item.status,
    cancellation: {
      refundPercentage: 50,
      refund: {
        alloy: Math.round(item.costAlloy * 0.5),
        heliox: Math.round(item.costHeliox * 0.5),
        aether: Math.round(item.costAether * 0.5),
      },
    },
  };
}

function presentPlanetResources(planet: {
  alloy: number;
  heliox: number;
  aether: number;
  lastProductionAt: Date;
}) {
  return {
    alloy: planet.alloy,
    heliox: planet.heliox,
    aether: planet.aether,
    lastProductionAt: planet.lastProductionAt,
  };
}

function buildingEffect(
  key: BuildingKey,
  currentLevel: number,
  nextLevel: number,
  solarIndex: number,
  economySpeed: number,
  planetType: string,
  currentProduction: { alloy: number; heliox: number; aether: number },
  projectedProductionEfficiency: number,
) {
  const definition = BUILDINGS[key];
  if (definition.producesResource) {
    const multiplier = planetProductionMultiplier(
      {
        type: PLANET_TYPE_DB_TO_SHARED[planetType] ?? 'temperate',
        temperature: 0,
        solarIndex,
      },
      definition.producesResource,
    );
    return {
      kind: 'resource-production',
      label: `${definition.producesResource[0].toUpperCase()}${definition.producesResource.slice(1)} output`,
      unit: 'per hour',
      current: currentProduction[definition.producesResource],
      next:
        hourlyProduction(key as 'alloyMine' | 'helioxExtractor' | 'aetherSynthesizer', nextLevel, multiplier, economySpeed) *
        projectedProductionEfficiency,
    };
  }

  const storageResource =
    key === 'alloyStorage' ? 'Alloy' : key === 'helioxStorage' ? 'Heliox' : key === 'aetherStorage' ? 'Aether' : null;
  if (storageResource) {
    return {
      kind: 'storage-capacity',
      label: `${storageResource} capacity`,
      unit: 'stored',
      current: storageCapacity(currentLevel),
      next: storageCapacity(nextLevel),
    };
  }

  if (key === 'solarArray') {
    return {
      kind: 'energy-generation',
      label: 'Grid generation',
      unit: 'energy',
      current: Math.max(0, -buildingEnergy(key, currentLevel, solarIndex)),
      next: Math.max(0, -buildingEnergy(key, nextLevel, solarIndex)),
    };
  }
  if (key === 'researchLab') {
    return {
      kind: 'construction-support',
      label: 'Construction acceleration',
      unit: 'speed factor',
      current: currentLevel + 1,
      next: nextLevel + 1,
    };
  }
  if (key === 'shipyard') {
    return {
      kind: 'shipbuilding',
      label: 'Shipbuilding speed',
      unit: 'speed factor',
      current: Math.max(1, Math.log2(currentLevel + 2)),
      next: Math.max(1, Math.log2(nextLevel + 2)),
    };
  }
  return {
    kind: 'facility-capability',
    label: 'Facility capability',
    unit: 'level',
    current: currentLevel,
    next: nextLevel,
  };
}

function energyEffect(key: BuildingKey, level: number, solarIndex: number) {
  const value = buildingEnergy(key, level, solarIndex);
  return {
    kind: value < 0 ? ('supply' as const) : value > 0 ? ('demand' as const) : ('none' as const),
    amount: Math.abs(value),
  };
}

function presentPrerequisite(requirement: {
  buildingId: BuildingKey;
  requiredLevel: number;
  currentLevel: number;
  met: boolean;
}) {
  return {
    buildingId: requirement.buildingId,
    buildingName: BUILDINGS[requirement.buildingId].name,
    requiredLevel: requirement.requiredLevel,
    currentLevel: requirement.currentLevel,
    met: requirement.met,
  };
}

function presentUnmetPrerequisite(requirement: {
  buildingId: BuildingKey;
  requiredLevel: number;
  currentLevel: number;
}) {
  return {
    buildingId: requirement.buildingId,
    buildingName: BUILDINGS[requirement.buildingId].name,
    requiredLevel: requirement.requiredLevel,
    currentLevel: requirement.currentLevel,
  };
}

router.get<{ planetId: string }>('/', asyncHandler(async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  const currentTime = new Date();
  const synced = await syncPlanetResources(planet.id, currentTime);
  const levels = Object.fromEntries(
    synced.buildings.map((building) => [building.key, building.level]),
  ) as Partial<Record<BuildingKey, number>>;
  const [pending, config] = await Promise.all([
    prisma.buildQueueItem.findMany({
      where: { planetId: planet.id, status: 'PENDING' },
      orderBy: [{ completesAt: 'asc' }, { id: 'asc' }],
    }),
    getUniverseConfig(),
  ]);
  const hasActiveConstruction = pending.length > 0;
  const catalog = Object.values(BUILDINGS).map((definition) => {
    const currentLevel = levels[definition.key] ?? 0;
    const nextLevel = currentLevel + 1;
    const upgradeCost = buildingCost(definition.key, nextLevel);
    const projection = projectBuildingEnergy(levels, synced.planet.solarIndex, definition.key, nextLevel);
    const prerequisiteEvaluation = evaluateBuildingPrerequisites(definition.key, levels)!;
    const requirements = prerequisiteEvaluation.requirements.map(presentPrerequisite);
    const unmetRequirements = prerequisiteEvaluation.unmetRequirements.map(presentPrerequisite);
    const missingResources = {
      alloy: Math.max(0, upgradeCost.alloy - synced.planet.alloy),
      heliox: Math.max(0, upgradeCost.heliox - synced.planet.heliox),
      aether: Math.max(0, upgradeCost.aether - synced.planet.aether),
    };
    const affordable = Object.values(missingResources).every((amount) => amount === 0);
    let unavailableReasonCode: string | null = null;
    let unavailableReason: string | null = null;
    if (hasActiveConstruction) {
      unavailableReasonCode = ERROR_CODES.CONSTRUCTION_IN_PROGRESS;
      unavailableReason = 'Another building upgrade is already active.';
    } else if (!prerequisiteEvaluation.meetsPrerequisites) {
      unavailableReasonCode = ERROR_CODES.PREREQUISITES_NOT_MET;
      unavailableReason = `Requires ${unmetRequirements
        .map((requirement) => `${requirement.buildingName} level ${requirement.requiredLevel}`)
        .join(', ')}.`;
    } else if (!projection.energyRequirementMet) {
      unavailableReasonCode = ERROR_CODES.INSUFFICIENT_ENERGY;
      unavailableReason = `Requires ${Number(projection.shortfall.toFixed(2))} more energy.`;
    } else if (!affordable) {
      unavailableReasonCode = ERROR_CODES.INSUFFICIENT_RESOURCES;
      unavailableReason = 'Insufficient resources for this upgrade.';
    }

    return {
      id: definition.key,
      key: definition.key,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      currentLevel,
      level: currentLevel,
      nextLevel,
      upgradeCost,
      nextCost: upgradeCost,
      constructionDurationSeconds: buildingDurationSeconds(
        upgradeCost,
        levels.researchLab ?? 0,
        config.economySpeed,
      ),
      effect: buildingEffect(
        definition.key,
        currentLevel,
        nextLevel,
        synced.planet.solarIndex,
        config.economySpeed,
        synced.planet.planetType,
        synced.production,
        projection.projectedProductionEfficiency,
      ),
      energyEffect: {
        current: energyEffect(definition.key, currentLevel, synced.planet.solarIndex),
        next: energyEffect(definition.key, nextLevel, synced.planet.solarIndex),
      },
      energyProjection: {
        supply: projection.supply,
        currentDemand: projection.demand,
        projectedSupply: projection.projectedSupply,
        projectedDemand: projection.projectedDemand,
        projectedAvailable: projection.projectedAvailable,
        additionalRequired: projection.additionalEnergyRequired,
        shortfall: projection.shortfall,
      },
      requirements,
      unmetRequirements,
      meetsPrerequisites: prerequisiteEvaluation.meetsPrerequisites,
      missingResources,
      affordable,
      hasSufficientEnergy: projection.hasSufficientEnergy,
      energyRequirementMet: projection.energyRequirementMet,
      canConstruct: unavailableReasonCode === null,
      unavailableReasonCode,
      unavailableReason,
    };
  });
  res.json({
    categories: BUILDING_CATEGORIES.filter((category) =>
      catalog.some((building) => building.category === category.key),
    ),
    catalog,
    queue: pending.map(presentQueueItem),
    planet: presentPlanetResources(synced.planet),
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

    const pending = await tx.buildQueueItem.findFirst({
      where: { planetId: lockedPlanet.id, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) return { kind: 'in-progress' as const };
    if (!(requestedKey in BUILDINGS)) return { kind: 'unknown-building' as const };

    const key = requestedKey as BuildingKey;

    const buildings = await tx.building.findMany({ where: { planetId: lockedPlanet.id } });
    const buildingLevels = Object.fromEntries(
      buildings.map((building) => [building.key, building.level]),
    ) as Partial<Record<BuildingKey, number>>;
    const targetLevel = (buildingLevels[key] ?? 0) + 1;
    const prerequisiteEvaluation = evaluateBuildingPrerequisites(key, buildingLevels)!;
    if (!prerequisiteEvaluation.meetsPrerequisites) {
      return {
        kind: 'requirements' as const,
        requirements: prerequisiteEvaluation.unmetRequirements.map(presentUnmetPrerequisite),
      };
    }

    const energy = projectBuildingEnergy(buildingLevels, lockedPlanet.solarIndex, key, targetLevel);
    if (!energy.energyRequirementMet) {
      return {
        kind: 'insufficient-energy' as const,
        details: {
          supply: energy.supply,
          currentDemand: energy.demand,
          projectedDemand: energy.projectedDemand,
          shortfall: energy.shortfall,
        },
      };
    }

    const synced = await syncLockedPlanetResources(tx, lockedPlanet, startedAt, config.economySpeed);

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
    sendError(
      res,
      409,
      ERROR_CODES.PREREQUISITES_NOT_MET,
      'Building prerequisites have not been met.',
      { requirements: outcome.requirements },
    );
    return;
  }
  if (outcome.kind === 'insufficient-energy') {
    sendError(
      res,
      409,
      ERROR_CODES.INSUFFICIENT_ENERGY,
      'Insufficient energy capacity for this upgrade.',
      outcome.details,
    );
    return;
  }
  if (outcome.kind === 'insufficient') {
    sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources', { cost: outcome.cost });
    return;
  }

  await scheduleBuildCompletion(outcome.item);
  res.status(201).json({ queueItem: presentQueueItem(outcome.item) });
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

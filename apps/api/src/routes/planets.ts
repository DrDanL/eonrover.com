import { Router } from 'express';
import {
  BUILDINGS,
  BuildingKey,
  evaluateBuildingPrerequisites,
  projectBuildingEnergy,
  storageCapacity,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import {
  getPlanetFullState,
  syncLockedPlanetResources,
  syncPlanetResources,
  withLockedPlanet,
} from '../services/planetService';
import { AppError, asyncHandler, ERROR_CODES, sendError } from '../middleware/error';
import { completeDueBuildingConstructionsForPlanet } from '../services/buildingCompletionService';
import { getUniverseConfig } from '../services/gameConfig';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const planets = await prisma.planet.findMany({ where: { ownerId: req.user!.id } });
  const synced = await Promise.all(planets.map((p) => syncPlanetResources(p.id)));
  res.json({
    planets: synced.map(({ planet }) => planet),
  });
}));

router.get('/command-summary', asyncHandler(async (req, res) => {
  const serverTime = new Date();
  const requestedPlanetId = typeof req.query.planetId === 'string' && req.query.planetId.trim()
    ? req.query.planetId.trim()
    : null;
  const ownedPlanets = await prisma.planet.findMany({
    where: { ownerId: req.user!.id },
    orderBy: [{ isHomeworld: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      isHomeworld: true,
      galaxy: true,
      system: true,
      slot: true,
    },
  });
  const selectedPlanetId = requestedPlanetId ?? ownedPlanets[0]?.id ?? null;
  if (!selectedPlanetId) {
    res.json({
      serverTimestamp: serverTime,
      selectedPlanetId: null,
      selectedPlanet: null,
      ownedPlanets,
    });
    return;
  }
  if (!ownedPlanets.some((planet) => planet.id === selectedPlanetId)) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }

  await completeDueBuildingConstructionsForPlanet(selectedPlanetId, serverTime);
  const config = await getUniverseConfig();
  const ownerId = req.user!.id;
  const snapshot = await withLockedPlanet(selectedPlanetId, async (tx, lockedPlanet) => {
    if (lockedPlanet.ownerId !== ownerId) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    }
    const synced = await syncLockedPlanetResources(tx, lockedPlanet, serverTime, config.economySpeed);
    const activeConstruction = await tx.buildQueueItem.findFirst({
      where: { planetId: lockedPlanet.id, status: 'PENDING' },
      orderBy: [{ completesAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        buildingKey: true,
        targetLevel: true,
        startedAt: true,
        completesAt: true,
      },
    });
    return { synced, activeConstruction };
  });

  const buildingLevels = Object.fromEntries(
    snapshot.synced.buildings.map((building) => [building.key, building.level]),
  ) as Record<string, number>;
  const resourceBuildingKeys: BuildingKey[] = ['alloyMine', 'helioxExtractor', 'aetherSynthesizer'];
  const energyBlockedBuildingKeys = resourceBuildingKeys.filter((key) => {
    if (!evaluateBuildingPrerequisites(key, buildingLevels)?.meetsPrerequisites) return false;
    return !projectBuildingEnergy(
      buildingLevels,
      snapshot.synced.planet.solarIndex,
      key,
      (buildingLevels[key] ?? 0) + 1,
    ).energyRequirementMet;
  });
  const activeConstruction = snapshot.activeConstruction
    ? {
        id: snapshot.activeConstruction.id,
        buildingKey: snapshot.activeConstruction.buildingKey,
        buildingName:
          BUILDINGS[snapshot.activeConstruction.buildingKey as BuildingKey]?.name
          ?? snapshot.activeConstruction.buildingKey,
        targetLevel: snapshot.activeConstruction.targetLevel,
        startedAt: snapshot.activeConstruction.startedAt,
        completesAt: snapshot.activeConstruction.completesAt,
      }
    : null;

  res.json({
    serverTimestamp: serverTime,
    selectedPlanetId,
    selectedPlanet: {
      identity: {
        id: snapshot.synced.planet.id,
        name: snapshot.synced.planet.name,
        isHomeworld: snapshot.synced.planet.isHomeworld,
        coordinates: {
          galaxy: snapshot.synced.planet.galaxy,
          system: snapshot.synced.planet.system,
          slot: snapshot.synced.planet.slot,
        },
        planetType: snapshot.synced.planet.planetType,
        temperature: snapshot.synced.planet.temperature,
        solarIndex: snapshot.synced.planet.solarIndex,
      },
      resources: {
        alloy: snapshot.synced.planet.alloy,
        heliox: snapshot.synced.planet.heliox,
        aether: snapshot.synced.planet.aether,
      },
      storage: {
        alloy: storageCapacity(buildingLevels.alloyStorage ?? 0),
        heliox: storageCapacity(buildingLevels.helioxStorage ?? 0),
        aether: storageCapacity(buildingLevels.aetherStorage ?? 0),
      },
      productionPerHour: snapshot.synced.production,
      energy: snapshot.synced.energy,
      activeConstruction,
      buildings: Object.values(BUILDINGS).map((definition) => ({
        key: definition.key,
        name: definition.name,
        level: buildingLevels[definition.key] ?? 0,
      })),
      energyBlockedBuildingKeys,
    },
    ownedPlanets,
  });
}));

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get('/:id', asyncHandler(async (req, res) => {
  const owned = await assertOwnedPlanet(req.params.id, req.user!.id);
  if (!owned) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  const state = await getPlanetFullState(req.params.id);
  res.json(state);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const owned = await assertOwnedPlanet(req.params.id, req.user!.id);
  if (!owned) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : undefined;
  if (!name) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Invalid name');
    return;
  }
  const planet = await prisma.planet.update({ where: { id: req.params.id }, data: { name } });
  res.json({ planet });
}));

export default router;

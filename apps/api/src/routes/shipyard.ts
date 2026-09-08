import { Router } from 'express';
import { SHIPYARD_CATEGORIES, SHIPYARD_CATALOGUE, evaluateShipyardCatalogue } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getBuildingLevels, getResearchLevels } from '../services/requirements';
import { getUniverseConfig } from '../services/gameConfig';
import { asyncHandler, ERROR_CODES, sendError } from '../middleware/error';

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
  const [{ planet: settled }, ships, buildingLevels, researchLevels, queue, config] = await Promise.all([
    syncPlanetResources(planet.id),
    prisma.ship.findMany({ where: { planetId: planet.id } }),
    getBuildingLevels(planet.id),
    getResearchLevels(req.user!.id),
    prisma.shipyardQueueItem.findMany({
      where: { planetId: planet.id },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    }),
    getUniverseConfig(),
  ]);
  res.json({
    selectedPlanet: { id: settled.id, name: settled.name, shipyardLevel: buildingLevels.shipyard ?? 0, resources: { alloy: settled.alloy, heliox: settled.heliox, aether: settled.aether } },
    categories: SHIPYARD_CATEGORIES,
    catalog: SHIPYARD_CATALOGUE.map((entry) => ({ ...evaluateShipyardCatalogue({ id: entry.id, shipyardLevel: buildingLevels.shipyard ?? 0, economySpeed: config.economySpeed, buildingLevels, researchLevels }), owned: ships.find((ship) => ship.key === entry.id)?.count ?? 0 })),
    legacyQueue: queue.map((item) => ({ id: item.id, itemKey: item.itemKey, itemType: item.itemType, quantity: item.quantity, remaining: item.remaining, startedAt: item.startedAt, completesAt: item.completesAt, status: item.status })),
  });
}));

export default router;

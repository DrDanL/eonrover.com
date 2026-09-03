import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { getPlanetFullState, syncPlanetResources } from '../services/planetService';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const planets = await prisma.planet.findMany({ where: { ownerId: req.user!.id } });
  const synced = await Promise.all(planets.map((p) => syncPlanetResources(p.id)));
  res.json({
    planets: synced.map(({ planet }) => planet),
  });
});

async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  if (!planet || planet.ownerId !== userId) return null;
  return planet;
}

router.get('/:id', async (req, res) => {
  const owned = await assertOwnedPlanet(req.params.id, req.user!.id);
  if (!owned) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const state = await getPlanetFullState(req.params.id);
  res.json(state);
});

router.patch('/:id', async (req, res) => {
  const owned = await assertOwnedPlanet(req.params.id, req.user!.id);
  if (!owned) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : undefined;
  if (!name) {
    res.status(400).json({ error: 'Invalid name' });
    return;
  }
  const planet = await prisma.planet.update({ where: { id: req.params.id }, data: { name } });
  res.json({ planet });
});

export default router;

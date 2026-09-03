import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/:galaxy/:system', async (req, res) => {
  const galaxy = Number(req.params.galaxy);
  const system = Number(req.params.system);
  if (!Number.isInteger(galaxy) || !Number.isInteger(system) || galaxy < 1 || system < 1) {
    res.status(400).json({ error: 'Invalid coordinates' });
    return;
  }
  const planets = await prisma.planet.findMany({
    where: { galaxy, system },
    include: { owner: { select: { username: true, protectedUntil: true } } },
    orderBy: { slot: 'asc' },
  });
  const slots = Array.from({ length: 12 }, (_, i) => {
    const slot = i + 1;
    const planet = planets.find((p) => p.slot === slot);
    if (!planet) return { slot, empty: true };
    return {
      slot,
      empty: false,
      planetId: planet.id,
      name: planet.name,
      planetType: planet.planetType,
      owner: planet.owner.username,
      protected: planet.owner.protectedUntil ? planet.owner.protectedUntil > new Date() : false,
    };
  });
  res.json({ galaxy, system, slots });
});

export default router;

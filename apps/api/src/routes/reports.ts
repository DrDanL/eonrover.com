import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

const router = Router();
router.use(requireAuth);

router.get('/combat', asyncHandler(async (req, res) => {
  const reports = await prisma.combatReport.findMany({
    where: { OR: [{ attackerId: req.user!.id }, { defenderId: req.user!.id }] },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ reports });
}));

router.get('/espionage', asyncHandler(async (req, res) => {
  const reports = await prisma.espionageReport.findMany({
    where: { ownerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ reports });
}));

export default router;

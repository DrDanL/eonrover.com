import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { publicLeaderboardPreview } from './leaderboard';

const router = Router();

router.get('/stats', async (_req, res) => {
  const [playerCount, planetCount, allianceCount] = await Promise.all([
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.planet.count(),
    prisma.alliance.count(),
  ]);
  res.json({ playerCount, planetCount, allianceCount });
});

router.get('/leaderboard-preview', async (_req, res) => {
  res.json({ leaderboard: await publicLeaderboardPreview(10) });
});

router.get('/announcements', async (_req, res) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json({ announcements });
});

export default router;

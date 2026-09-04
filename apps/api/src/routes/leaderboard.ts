import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

const router = Router();

async function computeLeaderboard(limit: number) {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    include: { planets: { include: { buildings: true } }, allianceMembership: { include: { alliance: true } } },
  });
  const ranked = users
    .map((user) => {
      const planetCount = user.planets.length;
      const buildingScore = user.planets.reduce(
        (sum, planet) => sum + planet.buildings.reduce((s, b) => s + b.level, 0),
        0,
      );
      return {
        username: user.username,
        alliance: user.allianceMembership?.alliance.tag ?? null,
        planetCount,
        score: buildingScore * 10 + planetCount * 25,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return ranked;
}

router.get('/', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ leaderboard: await computeLeaderboard(100) });
}));

export async function publicLeaderboardPreview(limit = 10) {
  return computeLeaderboard(limit);
}

export default router;

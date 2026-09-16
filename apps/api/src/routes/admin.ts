import { MissionStatus, MissionType, Prisma, TransportMissionPhase } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireReadOnlyAuth, requireRole } from '../middleware/auth';
import { requireAdminPortalRuntime } from '../middleware/adminPortal';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
const ADMIN_PLAYER_LOOKUP_LIMIT = 25;

/**
 * The runtime guard is deliberately first: a disabled portal must not resolve
 * sessions or read any application state before returning its safe response.
 */
router.use(requireAdminPortalRuntime, requireReadOnlyAuth, requireRole('ADMIN'));

const playerLookupSchema = z.object({
  query: z.string().trim().min(2).max(100),
}).strict();

const canonicalOutboundWhere: Prisma.FleetMissionWhereInput = {
  OR: [
    { missionType: MissionType.DEPLOY, status: MissionStatus.OUTBOUND, deployOriginId: { not: null }, deployDestinationId: { not: null } },
    { missionType: MissionType.COLONIZE, status: MissionStatus.OUTBOUND, colonizationAccountId: { not: null } },
    { missionType: MissionType.TRANSPORT, status: MissionStatus.OUTBOUND, transportPhase: TransportMissionPhase.OUTBOUND, transportOriginId: { not: null }, transportDestinationId: { not: null } },
    { missionType: MissionType.ESPIONAGE, status: MissionStatus.OUTBOUND, espionageProbePhase: 'OUTBOUND', espionageOriginPlanetId: { not: null }, espionageTargetPlanetId: { not: null } },
    { missionType: MissionType.ATTACK, status: MissionStatus.OUTBOUND, corvetteStrikePhase: 'OUTBOUND', corvetteStrikeOriginPlanetId: { not: null }, corvetteStrikeTargetPlanetId: { not: null } },
    { missionType: MissionType.ATTACK, status: MissionStatus.OUTBOUND, frigateStrikePhase: 'OUTBOUND', frigateStrikeOriginPlanetId: { not: null }, frigateStrikeTargetPlanetId: { not: null } },
  ],
};

const canonicalReturningWhere: Prisma.FleetMissionWhereInput = {
  OR: [
    { missionType: MissionType.TRANSPORT, status: MissionStatus.RETURNING, transportPhase: TransportMissionPhase.RETURNING, transportOriginId: { not: null }, transportDestinationId: { not: null } },
    { missionType: MissionType.ESPIONAGE, status: MissionStatus.RETURNING, espionageProbePhase: 'RETURNING', espionageOriginPlanetId: { not: null }, espionageTargetPlanetId: { not: null } },
    { missionType: MissionType.ATTACK, status: MissionStatus.RETURNING, corvetteStrikePhase: 'RETURNING', corvetteStrikeOriginPlanetId: { not: null }, corvetteStrikeTargetPlanetId: { not: null } },
    { missionType: MissionType.ATTACK, status: MissionStatus.RETURNING, frigateStrikePhase: 'RETURNING', frigateStrikeOriginPlanetId: { not: null }, frigateStrikeTargetPlanetId: { not: null } },
  ],
};

const canonicalCapacityWaitWhere: Prisma.FleetMissionWhereInput = {
  missionType: MissionType.TRANSPORT,
  status: MissionStatus.OUTBOUND,
  transportPhase: TransportMissionPhase.AWAITING_DESTINATION_CAPACITY,
  transportOriginId: { not: null },
  transportDestinationId: { not: null },
};

router.get('/status', (_req, res) => {
  res.json({ status: 'read-only' });
});

router.get('/overview', asyncHandler(async (_req, res) => {
  const [pendingVerification, active, suspended, banned, verified, planets, outbound, returning, awaitingDestinationCapacity] = await Promise.all([
    prisma.user.count({ where: { status: 'PENDING_VERIFICATION' } }),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { status: 'BANNED' } }),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.planet.count(),
    prisma.fleetMission.count({ where: canonicalOutboundWhere }),
    prisma.fleetMission.count({ where: canonicalReturningWhere }),
    prisma.fleetMission.count({ where: canonicalCapacityWaitWhere }),
  ]);

  res.json({
    accounts: { pendingVerification, active, suspended, banned, verified },
    planets: { owned: planets },
    operations: { outbound, returning, awaitingDestinationCapacity },
  });
}));

router.get('/players', asyncHandler(async (req, res) => {
  const parsed = playerLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    sendValidationError(res, parsed.error, 'Invalid administrator player lookup');
    return;
  }
  const query = parsed.data.query;
  const players = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ username: 'asc' }, { email: 'asc' }],
    take: ADMIN_PLAYER_LOOKUP_LIMIT,
    select: { username: true, email: true, status: true, emailVerifiedAt: true },
  });
  res.json({
    players: players.map((player) => ({
      username: player.username,
      email: player.email,
      status: player.status,
      verified: player.emailVerifiedAt !== null,
    })),
  });
}));

const retiredAdminPaths = [
  '/dashboard',
  '/users',
  '/users/:id',
  '/users/:id/status',
  '/users/:id/rename',
  '/config',
  '/announcements',
  '/announcements/:id',
  '/messages/:id',
  '/alliances/:id',
  '/jobs',
  '/jobs/:queue/:id',
  '/security-events',
  '/audit-log',
  '/health',
];

router.all(retiredAdminPaths, (_req, res) => {
  sendError(
    res,
    503,
    ERROR_CODES.ADMIN_PORTAL_UNAVAILABLE,
    'Administrator management is not available in the read-only portal.',
  );
});

export default router;

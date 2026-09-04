import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_UNIVERSE_CONFIG } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { getUniverseConfig, setUniverseConfigValue } from '../services/gameConfig';
import { buildQueue, connection, fleetQueue, researchQueue, shipyardQueue } from '../lib/redis';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
router.use(requireAuth, requireRole('ADMIN', 'MODERATOR'));

async function logAudit(actorId: string, action: string, targetType?: string, targetId?: string, metadata?: unknown) {
  await prisma.auditLog.create({ data: { actorId, action, targetType, targetId, metadata: metadata as never } });
}

router.get('/dashboard', asyncHandler(async (_req, res) => {
  const [userCount, activeUsers, planetCount, fleetsInFlight, alliances] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.planet.count(),
    prisma.fleetMission.count({ where: { status: { in: ['OUTBOUND', 'RETURNING'] } } }),
    prisma.alliance.count(),
  ]);
  const queueCounts = await Promise.all(
    [buildQueue, researchQueue, shipyardQueue, fleetQueue].map(async (q) => ({
      name: q.name,
      waiting: await q.getWaitingCount(),
      delayed: await q.getDelayedCount(),
      active: await q.getActiveCount(),
      failed: await q.getFailedCount(),
    })),
  );
  res.json({ userCount, activeUsers, planetCount, fleetsInFlight, alliances, queues: queueCounts });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const users = await prisma.user.findMany({
    where: q
      ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }
      : undefined,
    take: 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      lastActiveAt: true,
    },
  });
  res.json({ users });
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      planets: { include: { buildings: true, ships: true, defences: true } },
      allianceMembership: { include: { alliance: true } },
    },
  });
  if (!user) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'User not found');
    return;
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
}));

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']) });

router.post('/users/:id/status', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: parsed.data.status } });
  if (parsed.data.status !== 'ACTIVE') {
    await prisma.session.deleteMany({ where: { userId: user.id } });
  }
  await logAudit(req.user!.id, `SET_STATUS_${parsed.data.status}`, 'User', user.id);
  res.json({ user: { id: user.id, status: user.status } });
}));

router.post('/users/:id/rename', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const schema = z.object({ username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_-]+$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error, 'Invalid username');
    return;
  }
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { username: parsed.data.username } });
  await logAudit(req.user!.id, 'RENAME_USER', 'User', user.id, { username: parsed.data.username });
  res.json({ user: { id: user.id, username: user.username } });
}));

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ config: await getUniverseConfig(), defaults: DEFAULT_UNIVERSE_CONFIG });
}));

const configSchema = z.object({
  key: z.enum(['universeSpeed', 'economySpeed', 'fleetSpeed', 'researchSpeed', 'newPlayerProtectionHours', 'maxPlanetsPerPlayer']),
  value: z.number().positive(),
});

router.post('/config', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  await setUniverseConfigValue(parsed.data.key, parsed.data.value);
  await logAudit(req.user!.id, 'SET_CONFIG', 'UniverseSetting', parsed.data.key, { value: parsed.data.value });
  res.json({ message: 'Configuration updated' });
}));

const announcementSchema = z.object({ title: z.string().min(1).max(150), body: z.string().min(1).max(5000) });

router.get('/announcements', asyncHandler(async (_req, res) => {
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ announcements });
}));

router.post('/announcements', asyncHandler(async (req, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const announcement = await prisma.announcement.create({ data: { ...parsed.data, authorId: req.user!.id } });
  await logAudit(req.user!.id, 'CREATE_ANNOUNCEMENT', 'Announcement', announcement.id);
  res.status(201).json({ announcement });
}));

router.delete('/announcements/:id', asyncHandler(async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } }).catch(() => undefined);
  await logAudit(req.user!.id, 'DELETE_ANNOUNCEMENT', 'Announcement', req.params.id);
  res.json({ message: 'Deleted' });
}));

router.delete('/messages/:id', asyncHandler(async (req, res) => {
  await prisma.message.delete({ where: { id: req.params.id } }).catch(() => undefined);
  await logAudit(req.user!.id, 'DELETE_MESSAGE', 'Message', req.params.id);
  res.json({ message: 'Deleted' });
}));

router.delete('/alliances/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  await prisma.alliance.delete({ where: { id: req.params.id } }).catch(() => undefined);
  await logAudit(req.user!.id, 'DELETE_ALLIANCE', 'Alliance', req.params.id);
  res.json({ message: 'Deleted' });
}));

router.get('/jobs', asyncHandler(async (_req, res) => {
  const queues = [buildQueue, researchQueue, shipyardQueue, fleetQueue];
  const jobs = await Promise.all(
    queues.map(async (q) => ({
      queue: q.name,
      failed: (await q.getFailed(0, 20)).map((j) => ({ id: j.id, name: j.name, data: j.data, failedReason: j.failedReason })),
      delayed: (await q.getDelayed(0, 20)).map((j) => ({ id: j.id, name: j.name, data: j.data })),
    })),
  );
  res.json({ jobs });
}));

router.delete('/jobs/:queue/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const queues: Record<string, typeof buildQueue> = {
    'build-queue': buildQueue,
    'research-queue': researchQueue,
    'shipyard-queue': shipyardQueue,
    'fleet-queue': fleetQueue,
  };
  const queue = queues[req.params.queue];
  if (!queue) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Unknown queue');
    return;
  }
  const job = await queue.getJob(req.params.id);
  await job?.remove();
  await logAudit(req.user!.id, 'CANCEL_JOB', req.params.queue, req.params.id);
  res.json({ message: 'Job removed' });
}));

router.get('/security-events', asyncHandler(async (_req, res) => {
  const events = await prisma.securityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ events });
}));

router.get('/audit-log', asyncHandler(async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { username: true } } },
  });
  res.json({ logs });
}));

router.get('/health', asyncHandler(async (_req, res) => {
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  let redisOk = true;
  try {
    await connection.ping();
  } catch {
    redisOk = false;
  }
  res.json({ database: dbOk, redis: redisOk, timestamp: new Date().toISOString() });
}));

export default router;

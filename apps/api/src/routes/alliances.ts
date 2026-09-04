import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const alliances = await prisma.alliance.findMany({
    include: { members: { include: { user: { select: { username: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ alliances });
}));

router.get('/mine', asyncHandler(async (req, res) => {
  const membership = await prisma.allianceMember.findUnique({
    where: { userId: req.user!.id },
    include: { alliance: { include: { members: { include: { user: { select: { username: true } } } } } } },
  });
  res.json({ membership });
}));

const createSchema = z.object({
  name: z.string().min(3).max(40),
  tag: z
    .string()
    .min(2)
    .max(6)
    .regex(/^[A-Z0-9]+$/, 'Tag must be uppercase letters/numbers'),
  description: z.string().max(500).optional(),
});

router.post('/', asyncHandler(async (req, res) => {
  const existingMembership = await prisma.allianceMember.findUnique({ where: { userId: req.user!.id } });
  if (existingMembership) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'You are already in an alliance');
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const alliance = await prisma.alliance.create({
    data: {
      ...parsed.data,
      members: { create: { userId: req.user!.id, rank: 'LEADER' } },
    },
  });
  res.status(201).json({ alliance });
}));

router.post('/:id/join', asyncHandler(async (req, res) => {
  const existingMembership = await prisma.allianceMember.findUnique({ where: { userId: req.user!.id } });
  if (existingMembership) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'You are already in an alliance');
    return;
  }
  const alliance = await prisma.alliance.findUnique({ where: { id: req.params.id } });
  if (!alliance) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Alliance not found');
    return;
  }
  await prisma.allianceMember.create({ data: { allianceId: alliance.id, userId: req.user!.id, rank: 'MEMBER' } });
  res.status(201).json({ message: 'Joined alliance' });
}));

router.post('/leave', asyncHandler(async (req, res) => {
  await prisma.allianceMember.delete({ where: { userId: req.user!.id } }).catch(() => undefined);
  res.json({ message: 'Left alliance' });
}));

export default router;

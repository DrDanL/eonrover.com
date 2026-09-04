import { Router } from 'express';
import { z } from 'zod';
import { GATE_ACTIVATION_FRAGMENTS, GATE_ACTIVATION_REQUIREMENTS } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

// List the current player's Gate Fragments and any Eon Gates on their planets.
router.get('/', asyncHandler(async (req, res) => {
  const [fragments, gates] = await Promise.all([
    prisma.gateFragment.findMany({ where: { ownerId: req.user!.id }, orderBy: { discoveredAt: 'asc' } }),
    prisma.eonGate.findMany({ where: { planet: { ownerId: req.user!.id } } }),
  ]);
  res.json({ fragments, gates, fragmentsRequired: GATE_ACTIVATION_FRAGMENTS });
}));

const activateSchema = z.object({ planetId: z.string() });

// Consume GATE_ACTIVATION_FRAGMENTS fragments to activate an Eon Gate on one
// of the player's own planets, requiring the Gate Observatory building and
// Gate Theory research to have been unlocked first.
router.post('/activate', asyncHandler(async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const planet = await prisma.planet.findUnique({ where: { id: parsed.data.planetId }, include: { gate: true } });
  if (!planet || planet.ownerId !== req.user!.id) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found');
    return;
  }
  if (planet.gate) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'This planet already has an Eon Gate');
    return;
  }

  const [observatory, gateTheory] = await Promise.all([
    prisma.building.findUnique({ where: { planetId_key: { planetId: planet.id, key: 'gateObservatory' } } }),
    prisma.research.findUnique({ where: { userId_key: { userId: req.user!.id, key: 'gateTheory' } } }),
  ]);
  if ((observatory?.level ?? 0) < GATE_ACTIVATION_REQUIREMENTS.gateObservatory) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Requires a Gate Observatory');
    return;
  }
  if ((gateTheory?.level ?? 0) < GATE_ACTIVATION_REQUIREMENTS.gateTheory) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Requires Gate Theory research');
    return;
  }

  const fragments = await prisma.gateFragment.findMany({
    where: { ownerId: req.user!.id },
    orderBy: { discoveredAt: 'asc' },
    take: GATE_ACTIVATION_FRAGMENTS,
  });
  if (fragments.length < GATE_ACTIVATION_FRAGMENTS) {
    sendError(
      res,
      402,
      ERROR_CODES.INSUFFICIENT_RESOURCES,
      `Requires ${GATE_ACTIVATION_FRAGMENTS} Gate Fragments`,
      { have: fragments.length },
    );
    return;
  }

  const gate = await prisma.$transaction(async (tx) => {
    await tx.gateFragment.deleteMany({ where: { id: { in: fragments.map((f) => f.id) } } });
    return tx.eonGate.create({ data: { planetId: planet.id, isVisible: true } });
  });

  res.status(201).json({ gate });
}));

const linkSchema = z.object({ planetId: z.string(), targetPlanetId: z.string() });

// Link two of the player's own activated gates so fleets can jump between
// them. Linking is symmetric and replaces any existing link on either side.
router.post('/link', asyncHandler(async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { planetId, targetPlanetId } = parsed.data;
  if (planetId === targetPlanetId) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Cannot link a gate to itself');
    return;
  }
  const [origin, target] = await Promise.all([
    prisma.planet.findUnique({ where: { id: planetId }, include: { gate: true } }),
    prisma.planet.findUnique({ where: { id: targetPlanetId }, include: { gate: true } }),
  ]);
  if (!origin || origin.ownerId !== req.user!.id || !origin.gate) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Origin gate not found');
    return;
  }
  if (!target || target.ownerId !== req.user!.id || !target.gate) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Target gate not found');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Clear any dangling links so the previous partners (if any) are left unlinked.
    if (origin.gate!.linkedGateId) await tx.eonGate.updateMany({ where: { id: origin.gate!.linkedGateId }, data: { linkedGateId: null } });
    if (target.gate!.linkedGateId) await tx.eonGate.updateMany({ where: { id: target.gate!.linkedGateId }, data: { linkedGateId: null } });
    await tx.eonGate.update({ where: { id: origin.gate!.id }, data: { linkedGateId: null } });
    await tx.eonGate.update({ where: { id: target.gate!.id }, data: { linkedGateId: null } });
    await tx.eonGate.update({ where: { id: origin.gate!.id }, data: { linkedGateId: target.gate!.id } });
    await tx.eonGate.update({ where: { id: target.gate!.id }, data: { linkedGateId: origin.gate!.id } });
  });

  res.json({ ok: true });
}));

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { GATE_ACTIVATION_FRAGMENTS, GATE_ACTIVATION_REQUIREMENTS } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// List the current player's Gate Fragments and any Eon Gates on their planets.
router.get('/', async (req, res) => {
  const [fragments, gates] = await Promise.all([
    prisma.gateFragment.findMany({ where: { ownerId: req.user!.id }, orderBy: { discoveredAt: 'asc' } }),
    prisma.eonGate.findMany({ where: { planet: { ownerId: req.user!.id } } }),
  ]);
  res.json({ fragments, gates, fragmentsRequired: GATE_ACTIVATION_FRAGMENTS });
});

const activateSchema = z.object({ planetId: z.string() });

// Consume GATE_ACTIVATION_FRAGMENTS fragments to activate an Eon Gate on one
// of the player's own planets, requiring the Gate Observatory building and
// Gate Theory research to have been unlocked first.
router.post('/activate', async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const planet = await prisma.planet.findUnique({ where: { id: parsed.data.planetId }, include: { gate: true } });
  if (!planet || planet.ownerId !== req.user!.id) {
    res.status(404).json({ error: 'Planet not found' });
    return;
  }
  if (planet.gate) {
    res.status(409).json({ error: 'This planet already has an Eon Gate' });
    return;
  }

  const [observatory, gateTheory] = await Promise.all([
    prisma.building.findUnique({ where: { planetId_key: { planetId: planet.id, key: 'gateObservatory' } } }),
    prisma.research.findUnique({ where: { userId_key: { userId: req.user!.id, key: 'gateTheory' } } }),
  ]);
  if ((observatory?.level ?? 0) < GATE_ACTIVATION_REQUIREMENTS.gateObservatory) {
    res.status(409).json({ error: 'Requires a Gate Observatory' });
    return;
  }
  if ((gateTheory?.level ?? 0) < GATE_ACTIVATION_REQUIREMENTS.gateTheory) {
    res.status(409).json({ error: 'Requires Gate Theory research' });
    return;
  }

  const fragments = await prisma.gateFragment.findMany({
    where: { ownerId: req.user!.id },
    orderBy: { discoveredAt: 'asc' },
    take: GATE_ACTIVATION_FRAGMENTS,
  });
  if (fragments.length < GATE_ACTIVATION_FRAGMENTS) {
    res.status(402).json({ error: `Requires ${GATE_ACTIVATION_FRAGMENTS} Gate Fragments`, have: fragments.length });
    return;
  }

  const gate = await prisma.$transaction(async (tx) => {
    await tx.gateFragment.deleteMany({ where: { id: { in: fragments.map((f) => f.id) } } });
    return tx.eonGate.create({ data: { planetId: planet.id, isVisible: true } });
  });

  res.status(201).json({ gate });
});

const linkSchema = z.object({ planetId: z.string(), targetPlanetId: z.string() });

// Link two of the player's own activated gates so fleets can jump between
// them. Linking is symmetric and replaces any existing link on either side.
router.post('/link', async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const { planetId, targetPlanetId } = parsed.data;
  if (planetId === targetPlanetId) {
    res.status(400).json({ error: 'Cannot link a gate to itself' });
    return;
  }
  const [origin, target] = await Promise.all([
    prisma.planet.findUnique({ where: { id: planetId }, include: { gate: true } }),
    prisma.planet.findUnique({ where: { id: targetPlanetId }, include: { gate: true } }),
  ]);
  if (!origin || origin.ownerId !== req.user!.id || !origin.gate) {
    res.status(404).json({ error: 'Origin gate not found' });
    return;
  }
  if (!target || target.ownerId !== req.user!.id || !target.gate) {
    res.status(404).json({ error: 'Target gate not found' });
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
});

export default router;

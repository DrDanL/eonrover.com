import { Router } from 'express';
import { z } from 'zod';
import { ShipKey, SHIPS, distanceBetween, flightDurationSeconds, fuelConsumption, GATE_TRAVEL_SECONDS } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { syncPlanetResources } from '../services/planetService';
import { getUniverseConfig } from '../services/gameConfig';
import { fleetQueue } from '../lib/redis';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const missions = await prisma.fleetMission.findMany({
    where: { origin: { ownerId: req.user!.id } },
    orderBy: { departedAt: 'desc' },
    take: 50,
  });
  res.json({ missions });
}));

const shipsSchema = z.record(z.string(), z.number().int().min(0));
const sendSchema = z.object({
  originId: z.string(),
  targetGalaxy: z.number().int().min(1),
  targetSystem: z.number().int().min(1),
  targetSlot: z.number().int().min(1),
  missionType: z.enum(['TRANSPORT', 'DEPLOY', 'ESPIONAGE', 'ATTACK', 'RAID', 'RECYCLE', 'COLONIZE', 'EXPLORE', 'GATE_TRAVEL']),
  ships: shipsSchema,
  cargo: z.object({ alloy: z.number().min(0), heliox: z.number().min(0), aether: z.number().min(0) }).optional(),
  speedPercent: z.number().int().min(10).max(100).default(100),
});

router.post('/', asyncHandler(async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const data = parsed.data;
  const origin = await prisma.planet.findUnique({ where: { id: data.originId } });
  if (!origin || origin.ownerId !== req.user!.id) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Origin planet not found');
    return;
  }

  const requestedShips = Object.entries(data.ships).filter(([, count]) => count > 0);
  if (requestedShips.length === 0) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Select at least one ship');
    return;
  }
  for (const [key] of requestedShips) {
    if (!(key in SHIPS)) {
      sendError(res, 400, ERROR_CODES.BAD_REQUEST, `Unknown ship ${key}`);
      return;
    }
  }
  if (data.missionType === 'COLONIZE' && (!requestedShips.some(([k]) => k === 'colonyShip'))) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Colonisation requires a colony ship');
    return;
  }

  const ownedShips = await prisma.ship.findMany({ where: { planetId: origin.id } });
  const ownedMap = new Map(ownedShips.map((s) => [s.key, s.count]));
  for (const [key, count] of requestedShips) {
    if ((ownedMap.get(key) ?? 0) < count) {
      sendError(res, 409, ERROR_CODES.CONFLICT, `Not enough ${key} at origin`);
      return;
    }
  }

  const target = await prisma.planet.findUnique({
    where: { galaxy_system_slot: { galaxy: data.targetGalaxy, system: data.targetSystem, slot: data.targetSlot } },
  });

  if (data.missionType === 'COLONIZE' && target) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Target slot is already occupied');
    return;
  }
  if (data.missionType !== 'COLONIZE' && data.missionType !== 'EXPLORE' && !target) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'No planet at that location');
    return;
  }

  if (data.missionType === 'GATE_TRAVEL') {
    if (!target) {
      sendError(res, 404, ERROR_CODES.NOT_FOUND, 'No planet at that location');
      return;
    }
    const originGate = await prisma.eonGate.findUnique({ where: { planetId: origin.id } });
    if (!originGate || !originGate.linkedGateId) {
      sendError(res, 409, ERROR_CODES.CONFLICT, 'Origin planet has no linked Eon Gate');
      return;
    }
    const targetGate = await prisma.eonGate.findUnique({ where: { planetId: target.id } });
    if (!targetGate || targetGate.id !== originGate.linkedGateId) {
      sendError(res, 409, ERROR_CODES.CONFLICT, 'Target planet is not linked to this Eon Gate');
      return;
    }
  }

  const distance = distanceBetween(
    { galaxy: origin.galaxy, system: origin.system, slot: origin.slot },
    { galaxy: data.targetGalaxy, system: data.targetSystem, slot: data.targetSlot },
  );
  const slowestSpeed = Math.min(...requestedShips.map(([key]) => SHIPS[key as ShipKey].speed));
  const config = await getUniverseConfig();
  const durationSeconds =
    data.missionType === 'GATE_TRAVEL' ? GATE_TRAVEL_SECONDS : flightDurationSeconds(distance, slowestSpeed, data.speedPercent, config.fleetSpeed);
  const fuel =
    data.missionType === 'GATE_TRAVEL' ? 0 : fuelConsumption(Object.fromEntries(requestedShips) as Partial<Record<ShipKey, number>>, distance, durationSeconds);

  const cargoCapacity = requestedShips.reduce((sum, [key, count]) => sum + SHIPS[key as ShipKey].cargo * count, 0);
  const cargo = data.cargo ?? { alloy: 0, heliox: 0, aether: 0 };
  const cargoTotal = cargo.alloy + cargo.heliox + cargo.aether;
  if (cargoTotal > cargoCapacity) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Cargo exceeds fleet capacity');
    return;
  }

  const { planet: fresh } = await syncPlanetResources(origin.id);
  const needed = { alloy: cargo.alloy, heliox: cargo.heliox + fuel, aether: cargo.aether };
  if (fresh.alloy < needed.alloy || fresh.heliox < needed.heliox || fresh.aether < needed.aether) {
    sendError(res, 402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources for cargo/fuel', { needed });
    return;
  }

  const arrivesAt = new Date(Date.now() + durationSeconds * 1000);

  const mission = await prisma.$transaction(async (tx) => {
    for (const [key, count] of requestedShips) {
      await tx.ship.update({ where: { planetId_key: { planetId: origin.id, key } }, data: { count: { decrement: count } } });
    }
    await tx.planet.update({
      where: { id: origin.id },
      data: { alloy: { decrement: needed.alloy }, heliox: { decrement: needed.heliox }, aether: { decrement: needed.aether } },
    });
    return tx.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target?.id,
        targetGalaxy: data.targetGalaxy,
        targetSystem: data.targetSystem,
        targetSlot: data.targetSlot,
        missionType: data.missionType,
        ships: Object.fromEntries(requestedShips),
        cargo,
        speedPercent: data.speedPercent,
        arrivesAt,
      },
    });
  });

  const delay = Math.max(0, arrivesAt.getTime() - Date.now());
  const job = await fleetQueue.add('fleet-arrive', { missionId: mission.id }, { delay, removeOnComplete: true, attempts: 3 });
  await prisma.fleetMission.update({ where: { id: mission.id }, data: { jobId: job.id } });

  res.status(201).json({ mission: { ...mission, jobId: job.id } });
}));

router.post('/:id/recall', asyncHandler(async (req, res) => {
  const mission = await prisma.fleetMission.findUnique({ where: { id: req.params.id }, include: { origin: true } });
  if (!mission || mission.origin.ownerId !== req.user!.id) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Mission not found');
    return;
  }
  if (mission.status !== 'OUTBOUND') {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Mission cannot be recalled');
    return;
  }
  if (mission.jobId) {
    const job = await fleetQueue.getJob(mission.jobId);
    await job?.remove().catch(() => undefined);
  }
  const now = new Date();
  const elapsed = now.getTime() - mission.departedAt.getTime();
  const total = mission.arrivesAt.getTime() - mission.departedAt.getTime();
  const remaining = Math.max(0, total - elapsed);
  const returnsAt = new Date(now.getTime() + remaining);
  const updated = await prisma.fleetMission.update({
    where: { id: mission.id },
    data: { status: 'RECALLED', returnsAt, arrivesAt: returnsAt },
  });
  const job = await fleetQueue.add(
    'fleet-return',
    { missionId: mission.id },
    { delay: remaining, removeOnComplete: true, attempts: 3 },
  );
  await prisma.fleetMission.update({ where: { id: mission.id }, data: { jobId: job.id } });
  res.json({ mission: updated });
}));

export default router;

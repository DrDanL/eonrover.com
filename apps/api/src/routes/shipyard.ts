import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { DEFENCES, DEFENCE_CATALOGUE, evaluateDefenceCatalogue, isActiveShipyardDefenceKey, SHIPS, SHIPYARD_BY_ID, SHIPYARD_CATEGORIES, SHIPYARD_CATALOGUE, ShipKey, completeDueShipyardForPlanet, completeShipyardBatch, evaluateShipyardCatalogue, shipyardDurationForCatalogue } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { shipyardQueue } from '../lib/redis';
import { requireAuth } from '../middleware/auth';
import { AppError, asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';
import { getUniverseConfig } from '../services/gameConfig';
import { syncLockedPlanetResources, syncPlanetResources } from '../services/planetService';

const router = Router({ mergeParams: true });
router.use(requireAuth);
const MAX_SHIPYARD_BATCH_QUANTITY = 100;
const TRANSACTION_ATTEMPTS = 3;
const startSchema = z.object({ key: z.string(), quantity: z.number().int().min(1).max(MAX_SHIPYARD_BATCH_QUANTITY) }).strict();

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001'));
}
async function assertOwnedPlanet(planetId: string, userId: string) {
  const planet = await prisma.planet.findUnique({ where: { id: planetId } });
  return planet?.ownerId === userId ? planet : null;
}
function shipyardJobId(queueItemId: string): string { return `ship-${queueItemId}`; }
function presentQueueItem(item: { id: string; itemKey: string; itemType: string; canonicalDefenceKey?: string | null; quantity: number; costAlloy: number; costHeliox: number; costAether: number; durationSeconds: number; startedAt: Date; completesAt: Date; status: string }) {
  const ship = SHIPYARD_BY_ID[item.itemKey as ShipKey];
  const defence = item.itemType === 'defence' && item.canonicalDefenceKey === item.itemKey && isActiveShipyardDefenceKey(item.itemKey) ? DEFENCES[item.itemKey] : undefined;
  return { id: item.id, shipKey: item.itemKey, shipName: ship ? SHIPS[ship.id].name : defence?.name ?? item.itemKey, quantity: item.quantity, cost: { alloy: item.costAlloy, heliox: item.costHeliox, aether: item.costAether }, durationSeconds: item.durationSeconds, startedAt: item.startedAt, completesAt: item.completesAt, status: item.status, cancellation: { refundPercentage: 50, refund: { alloy: Math.round(item.costAlloy * 0.5), heliox: Math.round(item.costHeliox * 0.5), aether: Math.round(item.costAether * 0.5) } } };
}
async function scheduleShipyardWakeup(item: { id: string; quantity: number; durationSeconds: number; completesAt: Date }): Promise<boolean> {
  const jobId = shipyardJobId(item.id);
  try {
    await shipyardQueue.add('complete-shipyard-unit', { queueItemId: item.id }, { jobId, delay: Math.max(0, item.completesAt.getTime() - Date.now()), removeOnComplete: true, attempts: 3 });
    await prisma.shipyardQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { jobId } });
    return true;
  } catch { return false; } // PostgreSQL acceptance remains authoritative; Stage 7C will reconcile wake-ups.
}

router.get<{ planetId: string }>('/', asyncHandler(async (req, res) => {
  const planet = await assertOwnedPlanet(req.params.planetId, req.user!.id);
  if (!planet) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }
  await completeDueShipyardForPlanet(prisma, planet.id);
  const [{ planet: settled }, ships, defences, buildings, research, queue, config] = await Promise.all([
    syncPlanetResources(planet.id), prisma.ship.findMany({ where: { planetId: planet.id } }), prisma.defence.findMany({ where: { planetId: planet.id } }), prisma.building.findMany({ where: { planetId: planet.id } }), prisma.research.findMany({ where: { userId: req.user!.id } }), prisma.shipyardQueueItem.findMany({ where: { planetId: planet.id }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] }), getUniverseConfig(),
  ]);
  const buildingLevels = Object.fromEntries(buildings.map((building) => [building.key, building.level]));
  const researchLevels = Object.fromEntries(research.map((row) => [row.key, row.level]));
  const active = queue.find((item) => item.status === 'PENDING' && (item.itemType === 'ship' || (item.itemType === 'defence' && item.canonicalDefenceKey === 'flakTurret' && item.itemKey === 'flakTurret')));
  const resources = { alloy: settled.alloy, heliox: settled.heliox, aether: settled.aether };
  const defenceCatalog = DEFENCE_CATALOGUE.map((entry) => {
    const evaluated = evaluateDefenceCatalogue({ id: entry.id, shipyardLevel: buildingLevels.shipyard ?? 0, economySpeed: config.economySpeed, buildingLevels, researchLevels, durationForBaseSeconds: shipyardDurationForCatalogue });
    const affordable = resources.alloy >= evaluated.cost.alloy && resources.heliox >= evaluated.cost.heliox && resources.aether >= evaluated.cost.aether;
    return { id: evaluated.key, name: evaluated.name, displayOrder: entry.displayOrder, availability: evaluated.availability, availabilityReason: evaluated.availabilityMessage, owned: defences.find((defence) => defence.key === evaluated.key)?.count ?? 0, cost: evaluated.cost, durationSeconds: evaluated.durationSeconds, statistics: evaluated.statistics, requirements: evaluated.requirements, meetsRequirements: evaluated.meetsRequirements, affordable, quantity: { min: 1, max: MAX_SHIPYARD_BATCH_QUANTITY }, fieldState: { capacity: settled.fieldCapacity, used: buildings.length }, energyRequired: 0 };
  });
  res.json({ selectedPlanet: { id: settled.id, name: settled.name, shipyardLevel: buildingLevels.shipyard ?? 0, resources }, categories: SHIPYARD_CATEGORIES, catalog: SHIPYARD_CATALOGUE.map((entry) => ({ ...evaluateShipyardCatalogue({ id: entry.id, shipyardLevel: buildingLevels.shipyard ?? 0, economySpeed: config.economySpeed, buildingLevels, researchLevels }), owned: ships.find((ship) => ship.key === entry.id)?.count ?? 0 })), defences: defenceCatalog, activeQueue: active ? presentQueueItem(active) : null, legacyQueue: queue.filter((item) => item.id !== active?.id).map((item) => ({ id: item.id, itemKey: item.itemKey, itemType: item.itemType, quantity: item.quantity, remaining: item.remaining, startedAt: item.startedAt, completesAt: item.completesAt, status: item.status })) });
}));

router.post<{ planetId: string }>('/', asyncHandler(async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const isShip = parsed.data.key in SHIPYARD_BY_ID;
  const isFlak = isActiveShipyardDefenceKey(parsed.data.key);
  if (!isShip && !isFlak) { sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'This Shipyard item is unavailable.'); return; }
  const key = parsed.data.key as ShipKey | 'flakTurret';
  if (!await assertOwnedPlanet(req.params.planetId, req.user!.id)) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Planet not found'); return; }
  const config = await getUniverseConfig(); const startedAt = new Date();
  await completeDueShipyardForPlanet(prisma, req.params.planetId, startedAt);
  let accepted: Awaited<ReturnType<typeof prisma.shipyardQueueItem.create>> | null = null;
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      accepted = await prisma.$transaction(async (tx) => {
        // Shared lock order: account → planet → Shipyard queue.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.user!.id} FOR UPDATE`;
        const account = await tx.user.findUnique({ where: { id: req.user!.id } });
        if (!account || account.status !== 'ACTIVE') throw new AppError(403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${req.params.planetId} FOR UPDATE`;
        const planet = await tx.planet.findUnique({ where: { id: req.params.planetId } });
        if (!planet || planet.ownerId !== account.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Planet not found');
        await tx.$queryRaw`SELECT "id" FROM "ShipyardQueueItem" WHERE "planetId" = ${planet.id} AND "status" = 'PENDING' FOR UPDATE`;
        if (await tx.shipyardQueueItem.findFirst({ where: { planetId: planet.id, status: 'PENDING' }, select: { id: true } })) throw new AppError(409, ERROR_CODES.CONSTRUCTION_IN_PROGRESS, 'Ship construction is already in progress on this planet.');
        const definition = isFlak ? DEFENCES.flakTurret : SHIPS[key as ShipKey];
        if (!definition) throw new AppError(400, ERROR_CODES.BAD_REQUEST, 'This Shipyard item is unavailable.');
        const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
        const buildingLevels = Object.fromEntries(buildings.map((row) => [row.key, row.level]));
        const researchRows = await tx.research.findMany({ where: { userId: account.id } });
        const researchLevels = Object.fromEntries(researchRows.map((row) => [row.key, row.level]));
        const requirements = Object.entries(definition.requires ?? {}).map(([id, requiredLevel]) => ({ id, requiredLevel, currentLevel: buildingLevels[id] ?? researchLevels[id] ?? 0, met: (buildingLevels[id] ?? researchLevels[id] ?? 0) >= requiredLevel }));
        if (requirements.some((requirement) => !requirement.met)) throw new AppError(409, ERROR_CODES.PREREQUISITES_NOT_MET, 'Ship prerequisites have not been met.', { requirements });
        const synced = await syncLockedPlanetResources(tx, planet, startedAt, config.economySpeed);
        const cost = { alloy: Math.round(definition.cost.alloy * parsed.data.quantity), heliox: Math.round(definition.cost.heliox * parsed.data.quantity), aether: Math.round(definition.cost.aether * parsed.data.quantity) };
        if (synced.planet.alloy < cost.alloy || synced.planet.heliox < cost.heliox || synced.planet.aether < cost.aether) throw new AppError(402, ERROR_CODES.INSUFFICIENT_RESOURCES, 'Insufficient resources', { cost });
        const durationSeconds = shipyardDurationForCatalogue(definition.buildTimeSeconds, buildingLevels.shipyard ?? 0, config.economySpeed) * parsed.data.quantity;
        const completesAt = new Date(startedAt.getTime() + durationSeconds * 1000);
        await tx.planet.update({ where: { id: planet.id }, data: { alloy: synced.planet.alloy - cost.alloy, heliox: synced.planet.heliox - cost.heliox, aether: synced.planet.aether - cost.aether } });
        return tx.shipyardQueueItem.create({ data: { planetId: planet.id, itemKey: key, itemType: isFlak ? 'defence' : 'ship', canonicalDefenceKey: isFlak ? 'flakTurret' : null, quantity: parsed.data.quantity, remaining: parsed.data.quantity, costAlloy: cost.alloy, costHeliox: cost.heliox, costAether: cost.aether, durationSeconds, startedAt, completesAt } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (isSerializationFailure(error) && attempt + 1 < TRANSACTION_ATTEMPTS) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, ERROR_CODES.CONSTRUCTION_IN_PROGRESS, 'Ship construction is already in progress on this planet.');
      throw error;
    }
  }
  if (!accepted) throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Ship construction could not be started. Please try again.');
  const scheduled = await scheduleShipyardWakeup(accepted);
  res.status(201).json({ queueItem: presentQueueItem(accepted), scheduling: scheduled ? 'scheduled' : 'pending' });
}));

router.delete<{ planetId: string; queueItemId: string }>('/:queueItemId', asyncHandler(async (req, res) => {
  const initial = await prisma.shipyardQueueItem.findUnique({ where: { id: req.params.queueItemId }, select: { planetId: true } });
  if (!initial || initial.planetId !== req.params.planetId) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Ship construction not found'); return; }
  const completion = await completeShipyardBatch(prisma, req.params.queueItemId);
  if (completion !== 'too-early') { sendError(res, 409, ERROR_CODES.CONSTRUCTION_NOT_CANCELLABLE, 'This ship construction can no longer be cancelled.'); return; }
  const config = await getUniverseConfig(); const cancelledAt = new Date();
  let cancelled: { item: Awaited<ReturnType<typeof prisma.shipyardQueueItem.findUniqueOrThrow>>; refund: { alloy: number; heliox: number; aether: number } } | null = null;
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      cancelled = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.user!.id} FOR UPDATE`;
        const account = await tx.user.findUnique({ where: { id: req.user!.id } });
        if (!account || account.status !== 'ACTIVE') throw new AppError(403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
        await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id" = ${initial.planetId} FOR UPDATE`;
        const planet = await tx.planet.findUnique({ where: { id: initial.planetId } });
        await tx.$queryRaw`SELECT "id" FROM "ShipyardQueueItem" WHERE "id" = ${req.params.queueItemId} FOR UPDATE`;
        const item = await tx.shipyardQueueItem.findUnique({ where: { id: req.params.queueItemId } });
        if (!planet || !item || planet.ownerId !== account.id || item.planetId !== planet.id) throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Ship construction not found');
        if (item.status !== 'PENDING' || item.completesAt <= new Date()) throw new AppError(409, ERROR_CODES.CONSTRUCTION_NOT_CANCELLABLE, 'This ship construction can no longer be cancelled.');
        const synced = await syncLockedPlanetResources(tx, planet, cancelledAt, config.economySpeed);
        if ((await tx.shipyardQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })).count !== 1) throw new AppError(409, ERROR_CODES.CONSTRUCTION_NOT_CANCELLABLE, 'This ship construction can no longer be cancelled.');
        const refund = { alloy: Math.round(item.costAlloy * 0.5), heliox: Math.round(item.costHeliox * 0.5), aether: Math.round(item.costAether * 0.5) };
        await tx.planet.update({ where: { id: planet.id }, data: { alloy: synced.planet.alloy + refund.alloy, heliox: synced.planet.heliox + refund.heliox, aether: synced.planet.aether + refund.aether } });
        return { item, refund };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) { if (isSerializationFailure(error) && attempt + 1 < TRANSACTION_ATTEMPTS) continue; throw error; }
  }
  if (!cancelled) throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Ship construction could not be cancelled. Please try again.');
  try { await shipyardQueue.remove(cancelled.item.jobId ?? shipyardJobId(cancelled.item.id)); } catch { /* PostgreSQL cancellation remains authoritative. */ }
  res.json({ queueItem: { id: cancelled.item.id, status: 'CANCELLED' }, refund: cancelled.refund });
}));

export default router;

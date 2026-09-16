import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  CORVETTE_STRIKE_RESOLVER_VERSION,
  CorvetteStrikePlan,
  GALAXY_COORDINATE_BOUNDS,
  planCorvetteStrike,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { getUniverseConfig } from './gameConfig';
import { syncLockedPlanetResources } from './planetService';
import { scheduleCorvetteStrikeArrivalWakeup } from './corvetteStrikeArrivalSchedulingService';
import { evaluateCombatTargetEligibility } from './combatTargetEligibility';

const ATTEMPTS = 3;
export type CorvetteStrikeLaunchErrorCode = 'ORIGIN_NOT_OWNED' | 'INVALID_TARGET' | 'TARGET_UNAVAILABLE' | 'TARGET_PROTECTED' | 'INSUFFICIENT_CORVETTES' | 'INSUFFICIENT_HELIOX' | 'STRIKE_IN_PROGRESS' | 'STRIKE_UNAVAILABLE';
export class CorvetteStrikeLaunchError extends Error { constructor(readonly code: CorvetteStrikeLaunchErrorCode, message: string) { super(message); this.name = 'CorvetteStrikeLaunchError'; } }
export type CorvetteStrikeLaunchInput = { userId: string; originPlanetId: string; target: unknown; quantity: unknown };
export type AcceptedCorvetteStrikeLaunch = { missionId: string; originPlanetId: string; target: { galaxy: number; system: number; slot: number }; ships: { corvette: number }; outboundFuelHeliox: number; returnFuelHeliox: number; outboundDurationSeconds: number; returnDurationSeconds: number; departedAt: Date; arrivesAt: Date; returnsAt: Date; phase: 'OUTBOUND' };
type Coordinates = { galaxy: number; system: number; slot: number };
function failure(code: CorvetteStrikeLaunchErrorCode, message: string): never { throw new CorvetteStrikeLaunchError(code, message); }
function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.code === '40001')); }
function targetCoordinates(value: unknown): Coordinates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('INVALID_TARGET', 'The strike target is invalid.');
  const record = value as Record<string, unknown>; const keys = Object.keys(record).sort(); const expected = ['galaxy', 'slot', 'system'];
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || !expected.every((key) => typeof record[key] === 'number' && Number.isSafeInteger(record[key]))
    || (record.galaxy as number) < GALAXY_COORDINATE_BOUNDS.galaxy.min
    || (record.galaxy as number) > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || (record.system as number) < GALAXY_COORDINATE_BOUNDS.system.min
    || (record.system as number) > GALAXY_COORDINATE_BOUNDS.system.max
    || (record.slot as number) < GALAXY_COORDINATE_BOUNDS.slot.min
    || (record.slot as number) > GALAXY_COORDINATE_BOUNDS.slot.max
  ) return failure('INVALID_TARGET', 'The strike target is invalid.');
  return record as Coordinates;
}
function assertInput(input: CorvetteStrikeLaunchInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['userId', 'originPlanetId', 'target', 'quantity'].includes(key)) || typeof input.userId !== 'string' || !input.userId || typeof input.originPlanetId !== 'string' || !input.originPlanetId) failure('INVALID_TARGET', 'The strike command is invalid.');
}
function plan(origin: Coordinates, target: Coordinates, quantity: unknown, fleetSpeed: number): CorvetteStrikePlan { try { return planCorvetteStrike({ origin, target, quantity, fleetSpeed }); } catch { return failure('INVALID_TARGET', 'The strike target or Corvette quantity is invalid.'); } }
function techSnapshot(rows: Array<{ key: string; level: number }>) { const value = new Map(rows.map((row) => [row.key, row.level])); return { weaponTech: value.get('weaponTech') ?? 0, shieldTech: value.get('shieldTech') ?? 0, armourTech: value.get('armourTech') ?? 0 }; }

/** Internal-only launch. No queue, report, notification, or target mutation occurs here. */
export async function launchCanonicalCorvetteStrike(input: CorvetteStrikeLaunchInput): Promise<AcceptedCorvetteStrikeLaunch> {
  assertInput(input); const target = targetCoordinates(input.target); const config = await getUniverseConfig();
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) try {
    const acceptedLaunch = await prisma.$transaction(async (tx) => {
      const candidate = await tx.planet.findUnique({ where: { galaxy_system_slot: target }, select: { id: true, ownerId: true } });
      if (!candidate) {
        const requestedOrigin = await tx.planet.findUnique({ where: { id: input.originPlanetId }, select: { ownerId: true, galaxy: true } });
        if (requestedOrigin?.ownerId === input.userId && requestedOrigin.galaxy !== target.galaxy) failure('INVALID_TARGET', 'The strike target is invalid.');
        failure('TARGET_UNAVAILABLE', 'The strike target is unavailable.');
      }
      for (const id of [...new Set([input.userId, candidate.ownerId])].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id} FOR UPDATE`;
      const attacker = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, status: true, emailVerifiedAt: true } });
      if (!attacker || attacker.status !== 'ACTIVE' || !attacker.emailVerifiedAt) failure('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
      await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id"=${input.originPlanetId} FOR UPDATE`;
      const origin = await tx.planet.findUnique({ where: { id: input.originPlanetId } });
      if (!origin || origin.ownerId !== attacker.id) failure('ORIGIN_NOT_OWNED', 'The origin planet is not available to this account.');
      await tx.$queryRaw`SELECT "id" FROM "Planet" WHERE "id"=${candidate.id} FOR UPDATE`;
      const destination = await tx.planet.findUnique({ where: { id: candidate.id }, include: { owner: { select: { id: true, status: true, emailVerifiedAt: true, protectedUntil: true } } } });
      const departedAt = new Date();
      const eligibility = evaluateCombatTargetEligibility({ attacker, origin, requestedTarget: target, target: destination, now: departedAt });
      if (!destination || !eligibility.eligible) failure(eligibility.code === 'TARGET_PROTECTED' ? 'TARGET_PROTECTED' : eligibility.code === 'INVALID_TARGET' ? 'INVALID_TARGET' : 'TARGET_UNAVAILABLE', eligibility.code === 'TARGET_PROTECTED' ? 'The strike target is protected.' : 'The strike target is unavailable.');
      const accepted = plan({ galaxy: origin.galaxy, system: origin.system, slot: origin.slot }, target, input.quantity, config.fleetSpeed);
      const synced = await syncLockedPlanetResources(tx, origin, departedAt, config.economySpeed);
      await tx.$queryRaw`SELECT "id" FROM "Ship" WHERE "planetId"=${origin.id} AND "key"='corvette' FOR UPDATE`;
      const corvettes = await tx.ship.findUnique({ where: { planetId_key: { planetId: origin.id, key: 'corvette' } }, select: { count: true } });
      await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "missionType"='ATTACK' AND "corvetteStrikeOriginPlanetId"=${origin.id} AND "corvetteStrikeTargetPlanetId" IS NOT NULL AND "corvetteStrikeAttackerId" IS NOT NULL AND "corvetteStrikeDefenderId" IS NOT NULL AND "corvetteStrikePhase" IN ('OUTBOUND','RETURNING') FOR UPDATE`;
      if (await tx.fleetMission.findFirst({ where: { missionType: 'ATTACK', corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: { not: null }, corvetteStrikeAttackerId: { not: null }, corvetteStrikeDefenderId: { not: null }, corvetteStrikePhase: { in: ['OUTBOUND', 'RETURNING'] } }, select: { id: true } })) failure('STRIKE_IN_PROGRESS', 'A Corvette strike is already active from this planet.');
      if (!corvettes || corvettes.count < accepted.ships.corvette) failure('INSUFFICIENT_CORVETTES', 'The origin planet does not have enough Corvettes.');
      const totalFuel = accepted.outboundFuelHeliox + accepted.returnFuelHeliox;
      if (synced.planet.heliox < totalFuel) failure('INSUFFICIENT_HELIOX', 'The origin planet does not have enough Heliox.');
      const reservation = await tx.ship.updateMany({ where: { planetId: origin.id, key: 'corvette', count: { gte: accepted.ships.corvette } }, data: { count: { decrement: accepted.ships.corvette } } });
      if (reservation.count !== 1) failure('INSUFFICIENT_CORVETTES', 'The origin planet does not have enough Corvettes.');
      await tx.planet.update({ where: { id: origin.id }, data: { heliox: synced.planet.heliox - totalFuel } });
      const technology = techSnapshot(await tx.research.findMany({ where: { userId: attacker.id, key: { in: ['weaponTech', 'shieldTech', 'armourTech'] } }, select: { key: true, level: true } }));
      const arrivesAt = new Date(departedAt.getTime() + accepted.outboundDurationSeconds * 1000); const returnsAt = new Date(arrivesAt.getTime() + accepted.returnDurationSeconds * 1000);
      const mission = await tx.fleetMission.create({ data: { originId: origin.id, targetId: destination.id, targetGalaxy: destination.galaxy, targetSystem: destination.system, targetSlot: destination.slot, missionType: 'ATTACK', ships: accepted.ships, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: accepted.speedPercent, departedAt, arrivesAt, returnsAt, status: 'OUTBOUND', corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: destination.id, corvetteStrikeAttackerId: attacker.id, corvetteStrikeDefenderId: destination.ownerId, corvetteStrikeShips: accepted.ships, corvetteStrikeOutboundFuelHeliox: accepted.outboundFuelHeliox, corvetteStrikeReturnFuelHeliox: accepted.returnFuelHeliox, corvetteStrikeOutboundDurationSeconds: accepted.outboundDurationSeconds, corvetteStrikeReturnDurationSeconds: accepted.returnDurationSeconds, corvetteStrikeResolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, corvetteStrikeResolverSeed: randomBytes(32).toString('hex'), corvetteStrikeAttackerTechnology: technology, corvetteStrikePhase: 'OUTBOUND' } });
      return { missionId: mission.id, originPlanetId: origin.id, target, ships: accepted.ships, outboundFuelHeliox: accepted.outboundFuelHeliox, returnFuelHeliox: accepted.returnFuelHeliox, outboundDurationSeconds: accepted.outboundDurationSeconds, returnDurationSeconds: accepted.returnDurationSeconds, departedAt, arrivesAt, returnsAt, phase: 'OUTBOUND' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    // Redis is only a post-commit wake-up. A failure intentionally leaves the
    // accepted reservation durable for reconciliation to recover later.
    await scheduleCorvetteStrikeArrivalWakeup(acceptedLaunch.missionId);
    return acceptedLaunch;
  } catch (error) {
    if (error instanceof CorvetteStrikeLaunchError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new CorvetteStrikeLaunchError('STRIKE_IN_PROGRESS', 'A Corvette strike is already active from this planet.');
    if (retryable(error) && attempt + 1 < ATTEMPTS) continue;
    if (retryable(error)) throw new CorvetteStrikeLaunchError('STRIKE_UNAVAILABLE', 'Strike launch could not be completed. Please try again.');
    throw error;
  }
  throw new CorvetteStrikeLaunchError('STRIKE_UNAVAILABLE', 'Strike launch could not be completed. Please try again.');
}

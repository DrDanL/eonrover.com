import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CORVETTE_STRIKE_RESOLVER_VERSION,
  corvetteStrikeArrivalJobId,
  corvetteStrikeReturnJobId,
  CorvetteStrikeSchedulingOutcome,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { prisma } from './prisma';
import {
  CorvetteStrikeArrivalReconciliationLoop,
  reconcilePendingCorvetteStrikeArrivalJobs,
  startCorvetteStrikeArrivalReconciliation,
} from './corvetteStrikeArrivalReconciler';

const NOW = new Date('2026-09-14T14:00:00.000Z');
let sequence = 0;
type MockQueue = { add: jest.Mock; getJob: jest.Mock };

function mockQueue(existing = new Map<string, string>()): MockQueue {
  return {
    getJob: jest.fn(async (id: string) => {
      const state = existing.get(id);
      return state ? { getState: jest.fn().mockResolvedValue(state) } : undefined;
    }),
    add: jest.fn(async (_name, _payload, options) => { existing.set(String(options.jobId), 'delayed'); return { id: options.jobId }; }),
  };
}

async function canonicalStrike(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: { email: `strike-reconcile-a-${sequence}@example.invalid`, username: `strike-reconcile-a-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const defender = await prisma.user.create({ data: { email: `strike-reconcile-d-${sequence}@example.invalid`, username: `strike-reconcile-d-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const origin = await prisma.planet.create({ data: { ownerId: attacker.id, name: 'Origin', galaxy: 1, system: 500 + sequence * 2, slot: 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: NOW } });
  const target = await prisma.planet.create({ data: { ownerId: defender.id, name: 'Target', galaxy: 1, system: 501 + sequence * 2, slot: 2, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: NOW } });
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = options.returnsAt ?? (phase === 'RETURNING' ? new Date(NOW.getTime() - 1) : new Date(NOW.getTime() + 60_000));
  const arrivesAt = options.arrivesAt ?? (phase === 'RETURNING' ? new Date(returnsAt.getTime() - 60_000) : new Date(NOW.getTime() - 1));
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ATTACK', ships: { legacy: true }, cargo: {}, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt, status: options.cancelled ? 'RECALLED' : phase,
    corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: target.id,
    corvetteStrikeAttackerId: attacker.id, corvetteStrikeDefenderId: defender.id,
    corvetteStrikeShips: options.malformed ? { corvette: 0 } : { corvette: 2 },
    corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1,
    corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60,
    corvetteStrikeResolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, corvetteStrikeResolverSeed: 'e'.repeat(64),
    corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.corvetteStrikeReport.create({ data: { missionId: mission.id, attackerId: attacker.id, defenderId: defender.id, createdAt: arrivesAt, resolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, resultSnapshot: { survivors: { attacker: { corvette: 2 } } } } });
  }
  return { attacker, defender, origin, target, mission };
}

describe('Corvette strike arrival reconciliation', () => {
  it('settles overdue outbound and returning missions once through the canonical completion path', async () => {
    const outbound = await canonicalStrike();
    const queue = mockQueue();
    expect(await reconcilePendingCorvetteStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 1, completed: 1, scheduled: 0, existing: 0, skipped: 0, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'RETURNING', corvetteStrikePhase: 'RETURNING' });
    expect(await prisma.corvetteStrikeReport.count({ where: { missionId: outbound.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [outbound.attacker.id, outbound.defender.id] } } })).toBe(2);
    await prisma.fleetMission.update({ where: { id: outbound.mission.id }, data: { returnsAt: new Date(NOW.getTime() - 1) } });
    expect((await reconcilePendingCorvetteStrikeArrivalJobs(prisma, queue as never, NOW)).completed).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'COMPLETE', corvetteStrikePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: outbound.origin.id, key: 'corvette' } } })).toMatchObject({ count: 2 });
  });

  it('restores missing future arrival and return jobs with exact deterministic contracts', async () => {
    const outbound = await canonicalStrike({ arrivesAt: new Date(NOW.getTime() + 90_000) });
    const returning = await canonicalStrike({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue();
    expect(await reconcilePendingCorvetteStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 2, completed: 0, scheduled: 2, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith('complete-corvette-strike-arrival', { missionId: outbound.mission.id }, expect.objectContaining({ jobId: corvetteStrikeArrivalJobId(outbound.mission.id), delay: 90_000 }));
    expect(queue.add).toHaveBeenCalledWith('complete-corvette-strike-return', { missionId: returning.mission.id }, expect.objectContaining({ jobId: corvetteStrikeReturnJobId(returning.mission.id), delay: 60_000 }));
  });

  it('retains valid live and terminal jobs without replacement', async () => {
    const future = await canonicalStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const returning = await canonicalStrike({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue(new Map([[corvetteStrikeArrivalJobId(future.mission.id), 'waiting'], [corvetteStrikeReturnJobId(returning.mission.id), 'completed']]));
    expect(await reconcilePendingCorvetteStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 2, skipped: 0, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips legacy, malformed, cancelled, and completed rows without mutation', async () => {
    const malformed = await canonicalStrike({ malformed: true, arrivesAt: new Date(NOW.getTime() + 60_000) });
    const cancelled = await canonicalStrike({ cancelled: true }); const complete = await canonicalStrike({ phase: 'COMPLETE' });
    const legacy = await prisma.fleetMission.create({ data: { originId: malformed.origin.id, targetId: malformed.target.id, targetGalaxy: malformed.target.galaxy, targetSystem: malformed.target.system, targetSlot: malformed.target.slot, missionType: 'ATTACK', ships: { corvette: 99 }, cargo: {}, arrivesAt: new Date(NOW.getTime() + 60_000), status: 'OUTBOUND' } });
    const queue = mockQueue();
    expect(await reconcilePendingCorvetteStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 1, completed: 0, scheduled: 0, existing: 0, skipped: 1, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: cancelled.mission.id } })).toMatchObject({ status: 'RECALLED' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: complete.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ corvetteStrikePhase: null });
  });

  it('caps scans at 100 and continues after an individual scheduling failure', async () => {
    const fakeDatabase = { fleetMission: { findMany: jest.fn().mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: `mission-${index}`, corvetteStrikePhase: 'OUTBOUND', arrivesAt: new Date(NOW.getTime() + 60_000), returnsAt: null }))) } };
    const scheduled = jest.fn().mockResolvedValue('scheduled');
    const capped = await reconcilePendingCorvetteStrikeArrivalJobs(fakeDatabase as never, mockQueue() as never, NOW, 500, undefined, scheduled, scheduled);
    expect(fakeDatabase.fleetMission.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 })); expect(capped.scanned).toBe(100); expect(scheduled).toHaveBeenCalledTimes(100);
    const one = await canonicalStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) }); const two = await canonicalStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const outcome = jest.fn<Promise<CorvetteStrikeSchedulingOutcome>, [string, Date]>().mockRejectedValueOnce(new Error('Redis down')).mockResolvedValueOnce('scheduled');
    const result = await reconcilePendingCorvetteStrikeArrivalJobs(prisma, mockQueue() as never, NOW, 100, undefined, outcome, outcome);
    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 1, existing: 0, skipped: 0, failed: 1 });
    expect(outcome).toHaveBeenCalledWith(one.mission.id, NOW); expect(outcome).toHaveBeenCalledWith(two.mission.id, NOW);
  });
});

describe('Corvette strike reconciliation lifecycle', () => {
  it('runs after startup, repeats at 30 seconds, prevents overlap, and clears its interval', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = { setInterval(next, ms) { expect(ms).toBe(30_000); callback = next; return 'corvette-strike-interval'; }, clearInterval: jest.fn() };
    let release: (() => void) | undefined; const pending = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const loop: CorvetteStrikeArrivalReconciliationLoop = startCorvetteStrikeArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1); callback?.(); expect(await loop.runNow()).toBe(false); expect(reconcile).toHaveBeenCalledTimes(1);
    release?.(); await new Promise<void>((resolve) => setImmediate(resolve)); callback?.(); await new Promise<void>((resolve) => setImmediate(resolve)); expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop(); expect(timer.clearInterval).toHaveBeenCalledWith('corvette-strike-interval');
  });

  it('wires startup after the dedicated queue is ready, cleans up shutdown, and never consumes fleet-queue', () => {
    const entry = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(entry).toContain("Promise.all([corvetteStrikeArrivalWorker.waitUntilReady(), corvetteStrikeArrivalQueue.waitUntilReady()])");
    expect(entry).toContain('startCorvetteStrikeArrivalReconciliation(');
    expect(entry).toContain('corvetteStrikeArrivalReconciliation?.stop()');
    expect(entry).not.toContain("new Worker('fleet-queue'");
  });
});

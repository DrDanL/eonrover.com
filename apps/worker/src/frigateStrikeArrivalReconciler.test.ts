import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FRIGATE_STRIKE_ARRIVAL_JOB_NAME,
  FRIGATE_STRIKE_RESOLVER_VERSION,
  FRIGATE_STRIKE_RETURN_JOB_NAME,
  FrigateStrikeSchedulingOutcome,
  frigateStrikeArrivalJobId,
  frigateStrikeReturnJobId,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { prisma } from './prisma';
import {
  FrigateStrikeArrivalReconciliationLoop,
  reconcilePendingFrigateStrikeArrivalJobs,
  startFrigateStrikeArrivalReconciliation,
} from './frigateStrikeArrivalReconciler';

const NOW = new Date('2026-09-16T14:00:00.000Z');
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

async function canonicalFrigateStrike(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: { email: `frigate-reconcile-a-${sequence}@example.invalid`, username: `frigate-reconcile-a-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const defender = await prisma.user.create({ data: { email: `frigate-reconcile-d-${sequence}@example.invalid`, username: `frigate-reconcile-d-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const origin = await prisma.planet.create({ data: { ownerId: attacker.id, name: 'Origin', galaxy: 1, system: 700 + sequence * 2, slot: 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: NOW } });
  const target = await prisma.planet.create({ data: { ownerId: defender.id, name: 'Target', galaxy: 1, system: 701 + sequence * 2, slot: 2, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: NOW } });
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = options.returnsAt ?? (phase === 'RETURNING' ? new Date(NOW.getTime() - 1) : new Date(NOW.getTime() + 60_000));
  const arrivesAt = options.arrivesAt ?? (phase === 'RETURNING' ? new Date(returnsAt.getTime() - 60_000) : new Date(NOW.getTime() - 1));
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ATTACK', ships: { legacy: true }, cargo: {}, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt, status: options.cancelled ? 'RECALLED' : phase,
    frigateStrikeOriginPlanetId: origin.id, frigateStrikeTargetPlanetId: target.id,
    frigateStrikeAttackerId: attacker.id, frigateStrikeDefenderId: defender.id,
    frigateStrikeShips: options.malformed ? { frigate: 0 } : { frigate: 2 },
    frigateStrikeOutboundFuelHeliox: 1, frigateStrikeReturnFuelHeliox: 1,
    frigateStrikeOutboundDurationSeconds: 60, frigateStrikeReturnDurationSeconds: 60,
    frigateStrikeResolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, frigateStrikeResolverSeed: 'e'.repeat(64),
    frigateStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, frigateStrikePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.frigateStrikeReport.create({ data: { missionId: mission.id, attackerId: attacker.id, defenderId: defender.id, createdAt: arrivesAt, resolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, resultSnapshot: { survivors: { attacker: { frigate: 2 } } } } });
  }
  return { attacker, defender, origin, target, mission };
}

describe('Frigate strike arrival reconciliation', () => {
  it('settles due canonical outbound and returning rows once through the authoritative completion path', async () => {
    const outbound = await canonicalFrigateStrike();
    const queue = mockQueue();
    expect(await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 1, completed: 1, scheduled: 0, existing: 0, skipped: 0, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'RETURNING', frigateStrikePhase: 'RETURNING' });
    expect(await prisma.frigateStrikeReport.count({ where: { missionId: outbound.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [outbound.attacker.id, outbound.defender.id] } } })).toBe(2);
    expect(queue.add).toHaveBeenCalledWith(FRIGATE_STRIKE_RETURN_JOB_NAME, { missionId: outbound.mission.id }, expect.objectContaining({ jobId: frigateStrikeReturnJobId(outbound.mission.id) }));
    await prisma.fleetMission.update({ where: { id: outbound.mission.id }, data: { returnsAt: new Date(NOW.getTime() - 1) } });
    expect((await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).completed).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'COMPLETE', frigateStrikePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: outbound.origin.id, key: 'frigate' } } })).toMatchObject({ count: 2 });
  });

  it('restores missing future arrival and return jobs with deterministic persisted contracts and remains idempotent', async () => {
    const outbound = await canonicalFrigateStrike({ arrivesAt: new Date(NOW.getTime() + 90_000) });
    const returning = await canonicalFrigateStrike({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue();
    expect(await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 2, completed: 0, scheduled: 2, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(FRIGATE_STRIKE_ARRIVAL_JOB_NAME, { missionId: outbound.mission.id }, expect.objectContaining({ jobId: frigateStrikeArrivalJobId(outbound.mission.id), delay: 90_000 }));
    expect(queue.add).toHaveBeenCalledWith(FRIGATE_STRIKE_RETURN_JOB_NAME, { missionId: returning.mission.id }, expect.objectContaining({ jobId: frigateStrikeReturnJobId(returning.mission.id), delay: 60_000 }));
    expect(await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 2, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('retains live and terminal jobs without replacement', async () => {
    const live = await canonicalFrigateStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const terminal = await canonicalFrigateStrike({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue(new Map([[frigateStrikeArrivalJobId(live.mission.id), 'waiting'], [frigateStrikeReturnJobId(terminal.mission.id), 'completed']]));
    expect(await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 2, skipped: 0, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips terminal, malformed, legacy generic, Corvette, and cancelled rows without mutation', async () => {
    const malformed = await canonicalFrigateStrike({ malformed: true, arrivesAt: new Date(NOW.getTime() + 60_000) });
    const cancelled = await canonicalFrigateStrike({ cancelled: true });
    const complete = await canonicalFrigateStrike({ phase: 'COMPLETE' });
    const legacy = await prisma.fleetMission.create({ data: { originId: malformed.origin.id, targetId: malformed.target.id, targetGalaxy: malformed.target.galaxy, targetSystem: malformed.target.system, targetSlot: malformed.target.slot, missionType: 'ATTACK', ships: { frigate: 99 }, cargo: {}, arrivesAt: new Date(NOW.getTime() + 60_000), status: 'OUTBOUND' } });
    const corvette = await prisma.fleetMission.create({ data: { originId: malformed.origin.id, targetId: malformed.target.id, targetGalaxy: malformed.target.galaxy, targetSystem: malformed.target.system, targetSlot: malformed.target.slot, missionType: 'ATTACK', ships: { corvette: 2 }, cargo: {}, arrivesAt: new Date(NOW.getTime() + 60_000), status: 'OUTBOUND', corvetteStrikeOriginPlanetId: malformed.origin.id, corvetteStrikeTargetPlanetId: malformed.target.id, corvetteStrikeAttackerId: malformed.attacker.id, corvetteStrikeDefenderId: malformed.defender.id, corvetteStrikeShips: { corvette: 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikeResolverVersion: 'corvette-strike-v2', corvetteStrikeResolverSeed: 'c'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: 'OUTBOUND' } });
    const queue = mockQueue();
    expect(await reconcilePendingFrigateStrikeArrivalJobs(prisma, queue as never, NOW)).toEqual({ scanned: 1, completed: 0, scheduled: 0, existing: 0, skipped: 1, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: cancelled.mission.id } })).toMatchObject({ status: 'RECALLED' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: complete.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ frigateStrikePhase: null });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: corvette.id } })).toMatchObject({ frigateStrikePhase: null, corvetteStrikePhase: 'OUTBOUND' });
  });

  it('caps scans at 100, continues after a row failure, and leaves PostgreSQL state intact', async () => {
    const fakeDatabase = { fleetMission: { findMany: jest.fn().mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: `mission-${index}`, frigateStrikePhase: 'OUTBOUND', arrivesAt: new Date(NOW.getTime() + 60_000), returnsAt: null }))) } };
    const scheduled = jest.fn().mockResolvedValue('scheduled');
    const capped = await reconcilePendingFrigateStrikeArrivalJobs(fakeDatabase as never, mockQueue() as never, NOW, 500, undefined, scheduled, scheduled);
    expect(fakeDatabase.fleetMission.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(capped.scanned).toBe(100);
    expect(scheduled).toHaveBeenCalledTimes(100);
    const first = await canonicalFrigateStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const second = await canonicalFrigateStrike({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const outcome = jest.fn<Promise<FrigateStrikeSchedulingOutcome>, [string, Date]>().mockRejectedValueOnce(new Error('Redis down')).mockResolvedValueOnce('scheduled');
    const result = await reconcilePendingFrigateStrikeArrivalJobs(prisma, mockQueue() as never, NOW, 100, undefined, outcome, outcome);
    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 1, existing: 0, skipped: 0, failed: 1 });
    expect(await prisma.fleetMission.count({ where: { id: { in: [first.mission.id, second.mission.id] } } })).toBe(2);
  });
});

describe('Frigate strike reconciliation loop', () => {
  it('runs at startup every 30 seconds, prevents overlap, releases after success, and clears its timer', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = { setInterval(next, intervalMs) { expect(intervalMs).toBe(30_000); callback = next; return 'frigate-strike-interval'; }, clearInterval: jest.fn() };
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const loop: FrigateStrikeArrivalReconciliationLoop = startFrigateStrikeArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    callback?.();
    expect(await loop.runNow()).toBe(false);
    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    callback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop();
    expect(timer.clearInterval).toHaveBeenCalledWith('frigate-strike-interval');
  });

  it('releases its overlap guard after failures so later reconciliation can proceed', async () => {
    const timer: BuildingReconciliationTimer = { setInterval: () => 'frigate-failure-interval', clearInterval: jest.fn() };
    const onError = jest.fn();
    const reconcile = jest.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(undefined);
    const loop = startFrigateStrikeArrivalReconciliation(reconcile, 30_000, onError, timer);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await loop.runNow()).toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('wires only the dedicated Frigate reconciliation after its queue is ready and never consumes fleet-queue', () => {
    const entry = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(entry).toContain("new Worker('frigate-strike-arrival-queue', processFrigateStrikeArrivalJob");
    expect(entry).toContain('Promise.all([frigateStrikeArrivalWorker.waitUntilReady(), frigateStrikeArrivalQueue.waitUntilReady()])');
    expect(entry).toContain('startFrigateStrikeArrivalReconciliation(');
    expect(entry).toContain('frigateStrikeArrivalReconciliation?.stop()');
    expect(entry).not.toContain("new Worker('fleet-queue'");
  });
});

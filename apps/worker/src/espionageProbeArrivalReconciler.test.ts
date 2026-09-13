import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  espionageProbeArrivalJobId,
  espionageProbeReturnJobId,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { prisma } from './prisma';
import {
  EspionageProbeArrivalReconciliationLoop,
  reconcilePendingEspionageProbeArrivalJobs,
  startEspionageProbeArrivalReconciliation,
} from './espionageProbeArrivalReconciler';

const NOW = new Date('2026-09-13T12:00:00.000Z');
let sequence = 0;

type MockQueue = { add: jest.Mock; getJob: jest.Mock };

function mockQueue(existing = new Map<string, string>()): MockQueue {
  return {
    getJob: jest.fn(async (jobId: string) => {
      const state = existing.get(jobId);
      return state ? { getState: jest.fn().mockResolvedValue(state) } : undefined;
    }),
    add: jest.fn(async (_name, _data, options) => {
      existing.set(String(options.jobId), 'delayed');
      return { id: options.jobId };
    }),
  };
}

async function canonicalProbe(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: {
    email: `probe-reconcile-attacker-${sequence}@example.invalid`, username: `probe-reconcile-attacker-${sequence}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: NOW,
  } });
  const defender = await prisma.user.create({ data: {
    email: `probe-reconcile-defender-${sequence}@example.invalid`, username: `probe-reconcile-defender-${sequence}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: NOW,
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: attacker.id, name: 'Probe reconciliation origin', galaxy: 1, system: 100 + sequence * 2, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  const target = await prisma.planet.create({ data: {
    ownerId: defender.id, name: 'Probe reconciliation target', galaxy: 1, system: 101 + sequence * 2, slot: 2,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = phase === 'RETURNING'
    ? options.returnsAt ?? new Date(NOW.getTime() - 1)
    : options.returnsAt;
  const arrivesAt = phase === 'RETURNING'
    ? new Date(returnsAt!.getTime() - 60_000)
    : options.arrivesAt ?? new Date(NOW.getTime() - 1);
  const canonicalReturnsAt = returnsAt ?? new Date(arrivesAt.getTime() + 60_000);
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id,
    targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ESPIONAGE', ships: { probe: 999 }, cargo: { alloy: 999 }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt: canonicalReturnsAt,
    status: options.cancelled ? 'RECALLED' : phase,
    espionageOriginPlanetId: origin.id, espionageTargetPlanetId: target.id,
    espionageOriginAccountId: attacker.id, espionageTargetAccountId: defender.id,
    espionageProbeShips: options.malformed ? { probe: 2 } : { probe: 1 },
    espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1,
    espionageOutboundDurationSeconds: 60, espionageReturnDurationSeconds: 60,
    espionageProbePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.espionageProbeReport.create({ data: {
      missionId: mission.id, attackerId: attacker.id, targetPlanetId: target.id, createdAt: arrivesAt,
      tier: 'IDENTITY', disclosureSnapshot: { tier: 'IDENTITY', target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot }, planetName: target.name, planetType: 'temperate', ownerUsername: defender.username } },
    } });
  }
  return { attacker, defender, origin, target, mission };
}

describe('Espionage Probe arrival reconciliation', () => {
  it('settles overdue canonical arrival and return exactly once', async () => {
    const outbound = await canonicalProbe();
    const queue = mockQueue();
    const first = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(first).toEqual({ scanned: 1, completed: 1, scheduled: 0, existing: 0, skipped: 0, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'RETURNING', espionageProbePhase: 'RETURNING' });
    expect(await prisma.espionageProbeReport.count({ where: { missionId: outbound.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [outbound.attacker.id, outbound.defender.id] } } })).toBe(2);
    expect(queue.add).toHaveBeenCalledWith(ESPIONAGE_PROBE_RETURN_JOB_NAME, { missionId: outbound.mission.id }, expect.objectContaining({ jobId: espionageProbeReturnJobId(outbound.mission.id) }));

    const dueReturnAt = new Date(NOW.getTime() - 1);
    await prisma.fleetMission.update({ where: { id: outbound.mission.id }, data: {
      departedAt: new Date(dueReturnAt.getTime() - 120_000),
      arrivesAt: new Date(dueReturnAt.getTime() - 60_000),
      returnsAt: dueReturnAt,
    } });
    const second = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(second.completed).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.mission.id } })).toMatchObject({ status: 'COMPLETE', espionageProbePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: outbound.origin.id, key: 'probe' } } })).toMatchObject({ count: 1 });
    expect(await prisma.espionageProbeReport.count({ where: { missionId: outbound.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [outbound.attacker.id, outbound.defender.id] } } })).toBe(2);
  });

  it('restores missing future arrival and return jobs with their deterministic persisted contracts', async () => {
    const outbound = await canonicalProbe({ arrivesAt: new Date(NOW.getTime() + 90_000) });
    const returning = await canonicalProbe({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue();
    const result = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 2, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, { missionId: outbound.mission.id }, expect.objectContaining({ jobId: espionageProbeArrivalJobId(outbound.mission.id), delay: 90_000 }));
    expect(queue.add).toHaveBeenCalledWith(ESPIONAGE_PROBE_RETURN_JOB_NAME, { missionId: returning.mission.id }, expect.objectContaining({ jobId: espionageProbeReturnJobId(returning.mission.id), delay: 60_000 }));

    const restart = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(restart).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 2, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('retains valid live and terminal deterministic jobs without replacement', async () => {
    const live = await canonicalProbe({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const terminal = await canonicalProbe({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue(new Map([
      [espionageProbeArrivalJobId(live.mission.id), 'waiting'],
      [espionageProbeReturnJobId(terminal.mission.id), 'completed'],
    ]));
    const result = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 2, skipped: 0, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips legacy, malformed, cancelled, and terminal Probe rows without effects', async () => {
    const malformed = await canonicalProbe({ malformed: true, arrivesAt: new Date(NOW.getTime() + 60_000) });
    const cancelled = await canonicalProbe({ cancelled: true });
    const terminal = await canonicalProbe({ phase: 'COMPLETE' });
    const legacy = await prisma.fleetMission.create({ data: {
      originId: malformed.origin.id, targetId: malformed.target.id,
      targetGalaxy: malformed.target.galaxy, targetSystem: malformed.target.system, targetSlot: malformed.target.slot,
      missionType: 'ESPIONAGE', ships: { probe: 99 }, cargo: { alloy: 99 }, speedPercent: 100,
      arrivesAt: new Date(NOW.getTime() + 60_000), status: 'OUTBOUND', jobId: 'legacy-probe-job',
    } });
    const queue = mockQueue();
    const result = await reconcilePendingEspionageProbeArrivalJobs(prisma, queue as never, NOW);
    expect(result).toEqual({ scanned: 1, completed: 0, scheduled: 0, existing: 0, skipped: 1, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: cancelled.mission.id } })).toMatchObject({ status: 'RECALLED' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: terminal.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ jobId: 'legacy-probe-job' });
  });

  it('continues after one failing row and caps a run at 100 rows', async () => {
    const first = await canonicalProbe({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const second = await canonicalProbe({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue();
    let calls = 0;
    const result = await reconcilePendingEspionageProbeArrivalJobs(
      prisma, queue as never, NOW, 100,
      undefined,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('Redis failed');
        return 'scheduled';
      },
      async () => 'scheduled',
    );
    expect(result.scanned).toBe(2);
    expect(result.failed + result.scheduled).toBe(2);
    expect(await prisma.fleetMission.count({ where: { id: { in: [first.mission.id, second.mission.id] } } })).toBe(2);

    const fakeDatabase = {
      fleetMission: {
        findMany: jest.fn().mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
          id: `mission-${index}`, espionageProbePhase: 'OUTBOUND', arrivesAt: new Date(NOW.getTime() + 60_000), returnsAt: null,
        }))),
      },
    };
    const scheduled = jest.fn().mockResolvedValue('scheduled');
    const capped = await reconcilePendingEspionageProbeArrivalJobs(fakeDatabase as never, queue as never, NOW, 500, undefined, scheduled, scheduled);
    expect(fakeDatabase.fleetMission.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(capped.scanned).toBe(100);
    expect(scheduled).toHaveBeenCalledTimes(100);
  });
});

describe('Espionage Probe arrival reconciliation loop', () => {
  it('runs at startup every 30 seconds, prevents overlap, and clears its timer', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = {
      setInterval(next, intervalMs) {
        expect(intervalMs).toBe(30_000);
        callback = next;
        return 'espionage-probe-arrival-interval';
      },
      clearInterval: jest.fn(),
    };
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const loop: EspionageProbeArrivalReconciliationLoop = startEspionageProbeArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    callback?.();
    expect(await loop.runNow()).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    callback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop();
    expect(timer.clearInterval).toHaveBeenCalledWith('espionage-probe-arrival-interval');
  });

  it('wires Probe startup reconciliation and shutdown cleanup without consuming legacy Fleet jobs', () => {
    const entry = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(entry).toContain('startEspionageProbeArrivalReconciliation(');
    expect(entry).toContain('espionageProbeArrivalReconciliation?.stop()');
    expect(entry).not.toContain("new Worker('fleet-queue'");
  });
});

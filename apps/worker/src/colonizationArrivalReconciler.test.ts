import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import {
  COLONY_STARTER_STATE,
  ColonizationArrivalSchedulingOutcome,
  colonizationArrivalJobId,
  deriveColonyCharacteristics,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { prisma } from './prisma';
import {
  ColonizationArrivalReconciliationLoop,
  reconcilePendingColonizationArrivalJobs,
  startColonizationArrivalReconciliation,
} from './colonizationArrivalReconciler';

const NOW = new Date('2026-09-11T12:00:00.000Z');
let coordinate = 1;

type MockQueue = { add: jest.Mock; getJob: jest.Mock };

function mockQueue(): MockQueue {
  const liveJobs = new Map<string, string>();
  return {
    getJob: jest.fn(async (jobId: string) => {
      const state = liveJobs.get(jobId);
      return state ? { getState: jest.fn().mockResolvedValue(state) } : undefined;
    }),
    add: jest.fn(async (_name, _data, options) => {
      liveJobs.set(String(options.jobId), 'delayed');
      return { id: options.jobId };
    }),
  };
}

async function canonicalColonization(arrivesAt: Date, options: {
  status?: 'OUTBOUND' | 'COMPLETE';
  malformed?: boolean;
  legacy?: boolean;
} = {}) {
  const system = 900 + coordinate;
  const user = await prisma.user.create({ data: {
    email: `colony-reconcile-${coordinate}@example.invalid`, username: `colony-reconcile-${coordinate++}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: NOW,
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Colonisation reconciliation origin', galaxy: 13, system, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 900, aether: 100, lastProductionAt: NOW,
  } });
  const missionId = randomUUID();
  const mission = await prisma.fleetMission.create({ data: {
    id: missionId, originId: origin.id, targetId: null,
    targetGalaxy: origin.galaxy, targetSystem: origin.system, targetSlot: 4,
    missionType: 'COLONIZE', ships: { colonyShip: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 },
    speedPercent: 100, departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, status: options.status ?? 'OUTBOUND',
    colonizationAccountId: options.legacy ? null : user.id,
    colonizationTargetGalaxy: options.legacy ? null : origin.galaxy,
    colonizationTargetSystem: options.legacy ? null : origin.system,
    colonizationTargetSlot: options.legacy ? null : 4,
    colonizationShips: options.legacy ? Prisma.JsonNull : { colonyShip: 1 },
    colonizationFuelHeliox: options.legacy ? null : 100,
    colonizationDurationSeconds: options.legacy ? null : 60,
    colonizationCharacteristics: options.legacy ? Prisma.JsonNull : deriveColonyCharacteristics(missionId),
    colonizationStarterState: options.legacy ? Prisma.JsonNull : options.malformed ? { resources: { alloy: 999 } } : {
      fieldCapacity: COLONY_STARTER_STATE.fieldCapacity,
      resources: { ...COLONY_STARTER_STATE.resources },
      buildings: { ...COLONY_STARTER_STATE.buildings },
    },
  } });
  return { user, origin, mission };
}

describe('colonisation-arrival reconciliation', () => {
  it('completes one overdue canonical colonisation exactly once with one colony and notification', async () => {
    const fixture = await canonicalColonization(new Date(NOW.getTime() - 1));
    const queue = mockQueue();

    const [first, second] = await Promise.all([
      reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW),
      reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW),
    ]);

    expect(first.completed + second.completed).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.planet.count({ where: { ownerId: fixture.user.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'COLONY_FOUNDED' } })).toBe(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('restores a missing future deterministic job using persisted arrival timing', async () => {
    const fixture = await canonicalColonization(new Date(NOW.getTime() + 90_000));
    const queue = mockQueue();

    const result = await reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 1, completed: 0, scheduled: 1, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'complete-colony-arrival',
      { missionId: fixture.mission.id },
      expect.objectContaining({ jobId: colonizationArrivalJobId(fixture.mission.id), delay: 90_000 }),
    );
  });

  it('retains an existing future deterministic job without duplication', async () => {
    const fixture = await canonicalColonization(new Date(NOW.getTime() + 60_000));
    const queue = mockQueue();
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') });

    const result = await reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 1, completed: 0, scheduled: 0, existing: 1, skipped: 0, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips terminal, malformed, and legacy rows without mutation', async () => {
    const legacy = await canonicalColonization(new Date(NOW.getTime() + 60_000), { legacy: true });
    const malformed = await canonicalColonization(new Date(NOW.getTime() + 60_000), { malformed: true });
    const terminal = await canonicalColonization(new Date(NOW.getTime() + 60_000), { status: 'COMPLETE' });
    const queue = mockQueue();

    const result = await reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 0, skipped: 2, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: terminal.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('continues through a failing row and caps every scan at 100', async () => {
    const first = await canonicalColonization(new Date(NOW.getTime() + 60_000));
    const second = await canonicalColonization(new Date(NOW.getTime() + 60_000));
    const queue = mockQueue();
    const schedule = jest.fn<Promise<ColonizationArrivalSchedulingOutcome>, [string, Date]>()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce('scheduled');

    const result = await reconcilePendingColonizationArrivalJobs(prisma, queue as never, NOW, 100, undefined, schedule);
    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 1, existing: 0, skipped: 0, failed: 1 });
    expect(schedule).toHaveBeenCalledWith(first.mission.id, NOW);
    expect(schedule).toHaveBeenCalledWith(second.mission.id, NOW);

    const database = { fleetMission: { findMany: jest.fn().mockResolvedValue([]) } };
    await reconcilePendingColonizationArrivalJobs(database as never, queue as never, NOW, 10_000);
    expect(database.fleetMission.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});

describe('colonisation-arrival reconciliation lifecycle', () => {
  it('runs immediately, repeats every 30 seconds, prevents overlap, and clears its interval', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = {
      setInterval(next, intervalMs) {
        expect(intervalMs).toBe(30_000);
        callback = next;
        return 'colonization-arrival-interval';
      },
      clearInterval: jest.fn(),
    };
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);

    const loop: ColonizationArrivalReconciliationLoop = startColonizationArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
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
    expect(timer.clearInterval).toHaveBeenCalledWith('colonization-arrival-interval');
  });

  it('wires startup reconciliation and shutdown cleanup without consuming the legacy fleet queue', () => {
    const entry = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(entry).toContain('startColonizationArrivalReconciliation(');
    expect(entry).toContain('colonizationArrivalReconciliation?.stop()');
    expect(entry).not.toContain("new Worker('fleet-queue'");
  });
});

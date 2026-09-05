import { buildCompletionJobId } from '@eonrover/shared';
import {
  BuildingReconciliationTimer,
  reconcilePendingBuildingJobs,
  startBuildingReconciliation,
} from './buildingReconciler';
import { prisma } from './prisma';

const NOW = new Date('2026-09-05T14:00:00.000Z');
let coordinate = 1;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  coordinate = 1;
});

afterEach(() => {
  jest.useRealTimers();
});

async function createPendingConstruction(completesAt: Date, jobId: string | null = null) {
  const testCoordinate = coordinate++;
  const user = await prisma.user.create({
    data: {
      email: `reconcile-${testCoordinate}@example.com`,
      username: `reconcile-${testCoordinate}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: NOW,
    },
  });
  const planet = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `Reconcile ${testCoordinate}`,
      galaxy: 7,
      system: 1,
      slot: testCoordinate,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 100,
      heliox: 100,
      aether: 0,
      lastProductionAt: NOW,
      buildings: { create: { key: 'alloyMine', level: 0 } },
    },
  });
  return prisma.buildQueueItem.create({
    data: {
      planetId: planet.id,
      buildingKey: 'alloyMine',
      targetLevel: 1,
      costAlloy: 60,
      costHeliox: 15,
      costAether: 0,
      startedAt: new Date(completesAt.getTime() - 60_000),
      completesAt,
      jobId,
    },
  });
}

function mockQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'scheduled' }),
    getJob: jest.fn().mockResolvedValue(undefined),
  };
}

describe('building job reconciliation', () => {
  it('restores a missing Stage 3B1 job with its deterministic identifier', async () => {
    const construction = await createPendingConstruction(new Date(NOW.getTime() - 60_000));
    const queue = mockQueue();

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 1, scheduled: 1, existing: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'complete-building',
      { queueItemId: construction.id },
      expect.objectContaining({ jobId: buildCompletionJobId(construction.id), delay: 0 }),
    );
    const persisted = await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: construction.id } });
    expect(persisted.jobId).toBe(buildCompletionJobId(construction.id));
  });

  it('removes and restores a failed deterministic job', async () => {
    const construction = await createPendingConstruction(NOW, buildCompletionJobId('obsolete'));
    const remove = jest.fn().mockResolvedValue(undefined);
    const queue = mockQueue();
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('failed'), remove });

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 1, scheduled: 1, existing: 0, failed: 0 });
    expect(await prisma.buildQueueItem.count()).toBe(1);
  });

  it('does not duplicate a waiting, delayed, or active job', async () => {
    const constructions = await Promise.all([
      createPendingConstruction(NOW),
      createPendingConstruction(new Date(NOW.getTime() + 60_000)),
      createPendingConstruction(new Date(NOW.getTime() - 60_000)),
    ]);
    const states = new Map([
      [buildCompletionJobId(constructions[0].id), 'waiting'],
      [buildCompletionJobId(constructions[1].id), 'delayed'],
      [buildCompletionJobId(constructions[2].id), 'active'],
    ]);
    const queue = mockQueue();
    queue.getJob.mockImplementation(async (jobId) => ({
      getState: jest.fn().mockResolvedValue(states.get(jobId) ?? 'unknown'),
      remove: jest.fn(),
    }));

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 3, scheduled: 0, existing: 3, failed: 0 });
  });

  it('ignores completed and cancelled database constructions', async () => {
    const completed = await createPendingConstruction(NOW);
    const cancelled = await createPendingConstruction(NOW);
    await prisma.buildQueueItem.update({ where: { id: completed.id }, data: { status: 'COMPLETE' } });
    await prisma.buildQueueItem.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    const queue = mockQueue();

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 0, scheduled: 0, existing: 0, failed: 0 });
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('scans bounded pages and schedules overdue records immediately and future records at finish', async () => {
    const overdue = await createPendingConstruction(new Date(NOW.getTime() - 30_000));
    const future = await createPendingConstruction(new Date(NOW.getTime() + 90_000));
    const queue = mockQueue();

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW, 1);

    expect(result.scanned).toBe(2);
    expect(result.scheduled).toBe(2);
    const optionsById = new Map(
      queue.add.mock.calls.map((call) => [(call[1] as { queueItemId: string }).queueItemId, call[2]]),
    );
    expect(optionsById.get(overdue.id)).toEqual(expect.objectContaining({ delay: 0 }));
    expect(optionsById.get(future.id)).toEqual(expect.objectContaining({ delay: 90_000 }));
  });

  it('continues reconciling after one construction cannot be scheduled', async () => {
    const first = await createPendingConstruction(NOW);
    const second = await createPendingConstruction(NOW);
    const queue = mockQueue();
    queue.getJob.mockImplementation(async (jobId) => {
      if (jobId === buildCompletionJobId(first.id)) throw new Error('Redis read failed');
      return undefined;
    });

    const result = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 2, scheduled: 1, existing: 0, failed: 1 });
    expect(queue.add).toHaveBeenCalledWith(
      'complete-building',
      { queueItemId: second.id },
      expect.any(Object),
    );
  });

  it('keeps repeated or restarted reconciliation idempotent', async () => {
    const construction = await createPendingConstruction(NOW);
    const liveJobs = new Set<string>();
    const queue = mockQueue();
    queue.getJob.mockImplementation(async (jobId) =>
      liveJobs.has(jobId)
        ? { getState: jest.fn().mockResolvedValue('waiting'), remove: jest.fn() }
        : undefined,
    );
    queue.add.mockImplementation(async (_name, _data, options) => {
      liveJobs.add(String(options?.jobId));
      return { id: options?.jobId };
    });

    await reconcilePendingBuildingJobs(prisma, queue as never, NOW);
    const repeated = await reconcilePendingBuildingJobs(prisma, queue as never, NOW);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(repeated).toEqual({ scanned: 1, scheduled: 0, existing: 1, failed: 0 });
    expect(liveJobs).toEqual(new Set([buildCompletionJobId(construction.id)]));
  });
});

describe('building reconciliation scheduling loop', () => {
  it('runs immediately at startup and never overlaps periodic executions', async () => {
    let intervalCallback: (() => void) | undefined;
    const clearInterval = jest.fn();
    const timer: BuildingReconciliationTimer = {
      setInterval(callback, intervalMs) {
        expect(intervalMs).toBe(30_000);
        intervalCallback = callback;
        return 'test-interval';
      },
      clearInterval,
    };
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const reconcile = jest.fn()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue(undefined);

    const loop = startBuildingReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    intervalCallback?.();
    expect(await loop.runNow()).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    intervalCallback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);

    loop.stop();
    expect(clearInterval).toHaveBeenCalledWith('test-interval');
  });
});

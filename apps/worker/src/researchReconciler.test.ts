import { prisma } from './prisma';
import {
  RESEARCH_RECONCILIATION_BATCH_SIZE,
  reconcilePendingResearchJobs,
  researchCompletionJobId,
  startResearchReconciliation,
} from './researchReconciler';
import { BuildingReconciliationTimer } from './buildingReconciler';

const NOW = new Date('2026-09-07T12:00:00.000Z');
let slot = 1;

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); jest.setSystemTime(NOW); });
afterEach(() => jest.useRealTimers());

async function pending(completesAt: Date) {
  const id = slot++;
  const user = await prisma.user.create({ data: { email: `research-reconcile-${id}@example.com`, username: `research-reconcile-${id}`, passwordHash: 'unused', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const planet = await prisma.planet.create({ data: { ownerId: user.id, name: `Research ${id}`, galaxy: 8, system: 1, slot: id, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 0, heliox: 0, aether: 0, lastProductionAt: NOW } });
  return prisma.researchQueueItem.create({ data: { userId: user.id, planetId: planet.id, researchKey: 'weaponTech', targetLevel: 1, costAlloy: 1, costHeliox: 1, costAether: 1, durationSeconds: 60, startedAt: NOW, completesAt } });
}

function queue() { return { add: jest.fn().mockResolvedValue({ id: 'job' }), getJob: jest.fn().mockResolvedValue(undefined) }; }

describe('research reconciliation', () => {
  it('completes overdue rows directly and restores missing future jobs without Redis ownership data', async () => {
    const overdue = await pending(new Date(NOW.getTime() - 1));
    const future = await pending(new Date(NOW.getTime() + 60_000));
    const jobs = queue();
    const result = await reconcilePendingResearchJobs(prisma, jobs as never, NOW);
    expect(result).toEqual({ scanned: 2, completed: 1, scheduled: 1, existing: 0, failed: 0 });
    expect(await prisma.researchQueueItem.findUniqueOrThrow({ where: { id: overdue.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.notification.count({ where: { userId: overdue.userId, type: 'RESEARCH_COMPLETE' } })).toBe(1);
    expect(jobs.add).toHaveBeenCalledWith('complete-research', { queueItemId: future.id }, expect.objectContaining({ jobId: researchCompletionJobId(future.id), delay: 60_000 }));
  });

  it('retains a live deterministic future job and caps one pass at 100 rows', async () => {
    const first = await pending(new Date(NOW.getTime() + 60_000));
    await Promise.all(Array.from({ length: RESEARCH_RECONCILIATION_BATCH_SIZE }, () => pending(new Date(NOW.getTime() + 60_000))));
    const jobs = queue();
    jobs.getJob.mockImplementation(async (id: string) => id === researchCompletionJobId(first.id) ? { getState: jest.fn().mockResolvedValue('delayed'), remove: jest.fn() } : undefined);
    const result = await reconcilePendingResearchJobs(prisma, jobs as never, NOW);
    expect(result.scanned).toBe(RESEARCH_RECONCILIATION_BATCH_SIZE);
    expect(result.existing).toBe(1);
    expect(jobs.add).toHaveBeenCalledTimes(RESEARCH_RECONCILIATION_BATCH_SIZE - 1);
  });

  it('starts immediately, prevents overlap, and clears its interval on shutdown', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = { setInterval: (fn, interval) => { expect(interval).toBe(30_000); callback = fn; return 'research-timer'; }, clearInterval: jest.fn() };
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const loop = startResearchReconciliation(reconcile, undefined, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    callback?.();
    expect(await loop.runNow()).toBe(false);
    release?.(); await new Promise<void>((resolve) => setImmediate(resolve));
    callback?.(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop(); expect(timer.clearInterval).toHaveBeenCalledWith('research-timer');
  });
});

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { completeResearch, ResearchCompletionResult } from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { ResearchJobData } from './processors/researchProcessor';

export const RESEARCH_RECONCILIATION_INTERVAL_MS = 30_000;
export const RESEARCH_RECONCILIATION_BATCH_SIZE = 100;
export const RESEARCH_COMPLETION_JOB_NAME = 'complete-research';

export function researchCompletionJobId(queueItemId: string): string {
  return `research-${queueItemId}`;
}

type ResearchQueue = Pick<Queue<ResearchJobData>, 'add' | 'getJob'>;
type CompleteResearch = (queueItemId: string, now: Date) => Promise<ResearchCompletionResult>;

export interface ResearchReconciliationResult {
  scanned: number;
  completed: number;
  scheduled: number;
  existing: number;
  failed: number;
}

const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);

/** Reconciles one deterministic, bounded snapshot. PostgreSQL rows decide both
 * whether work is due and whether a Redis job is needed. */
export async function reconcilePendingResearchJobs(
  database: PrismaClient,
  queue: ResearchQueue,
  currentTime = new Date(),
  batchSize = RESEARCH_RECONCILIATION_BATCH_SIZE,
  complete: CompleteResearch = (queueItemId, now) => completeResearch(database, queueItemId, now),
): Promise<ResearchReconciliationResult> {
  const result: ResearchReconciliationResult = { scanned: 0, completed: 0, scheduled: 0, existing: 0, failed: 0 };
  const items = await database.researchQueueItem.findMany({
    where: { status: 'PENDING' },
    orderBy: { id: 'asc' },
    take: Math.min(batchSize, RESEARCH_RECONCILIATION_BATCH_SIZE),
    select: { id: true, userId: true, completesAt: true },
  });

  for (const item of items) {
    result.scanned += 1;
    try {
      if (item.completesAt <= currentTime) {
        const outcome = await complete(item.id, currentTime);
        if (outcome === 'completed') result.completed += 1;
        continue;
      }

      const jobId = researchCompletionJobId(item.id);
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (LIVE_JOB_STATES.has(state)) {
          await database.researchQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { jobId } });
          result.existing += 1;
          continue;
        }
        if (state === 'failed' || state === 'completed') await existingJob.remove();
      }
      await queue.add(
        RESEARCH_COMPLETION_JOB_NAME,
        // Ownership is deliberately omitted: the processor looks up persisted data by id.
        { queueItemId: item.id } as ResearchJobData,
        {
          jobId,
          delay: Math.max(0, item.completesAt.getTime() - Math.max(currentTime.getTime(), Date.now())),
          removeOnComplete: true,
          attempts: 3,
        },
      );
      await database.researchQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { jobId } });
      result.scheduled += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export interface ResearchReconciliationLoop { runNow(): Promise<boolean>; stop(): void; }

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export function startResearchReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = RESEARCH_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): ResearchReconciliationLoop {
  let running = false;
  const runNow = async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    try { await reconcile(); } catch (error) { onError(error); } finally { running = false; }
    return true;
  };
  const interval = timer.setInterval(() => { void runNow(); }, intervalMs);
  void runNow();
  return { runNow, stop: () => timer.clearInterval(interval) };
}

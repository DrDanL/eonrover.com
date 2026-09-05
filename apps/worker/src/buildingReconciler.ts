import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  BUILD_COMPLETION_JOB_NAME,
  buildCompletionJobId,
} from '@eonrover/shared';

export const BUILDING_RECONCILIATION_INTERVAL_MS = 30_000;
export const BUILDING_RECONCILIATION_BATCH_SIZE = 100;

export interface BuildJobData {
  queueItemId: string;
}

type BuildingQueue = Pick<Queue<BuildJobData>, 'add' | 'getJob'>;

export interface BuildingReconciliationResult {
  scanned: number;
  scheduled: number;
  existing: number;
  failed: number;
}

const LIVE_JOB_STATES = new Set([
  'active',
  'delayed',
  'prioritized',
  'waiting',
  'waiting-children',
]);

export async function reconcilePendingBuildingJobs(
  database: PrismaClient,
  queue: BuildingQueue,
  currentTime = new Date(),
  batchSize = BUILDING_RECONCILIATION_BATCH_SIZE,
): Promise<BuildingReconciliationResult> {
  const result: BuildingReconciliationResult = { scanned: 0, scheduled: 0, existing: 0, failed: 0 };
  let cursor: string | undefined;

  while (true) {
    const constructions = await database.buildQueueItem.findMany({
      where: { status: 'PENDING' },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, completesAt: true },
    });
    if (constructions.length === 0) break;

    for (const construction of constructions) {
      result.scanned += 1;
      const jobId = buildCompletionJobId(construction.id);
      try {
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
          const state = await existingJob.getState();
          if (LIVE_JOB_STATES.has(state)) {
            await database.buildQueueItem.updateMany({
              where: { id: construction.id, status: 'PENDING' },
              data: { jobId },
            });
            result.existing += 1;
            continue;
          }
          if (state === 'failed' || state === 'completed') await existingJob.remove();
        }

        await queue.add(
          BUILD_COMPLETION_JOB_NAME,
          { queueItemId: construction.id },
          {
            jobId,
            delay: Math.max(
              0,
              construction.completesAt.getTime() - Math.max(currentTime.getTime(), Date.now()),
            ),
            removeOnComplete: true,
            attempts: 3,
          },
        );
        await database.buildQueueItem.updateMany({
          where: { id: construction.id, status: 'PENDING' },
          data: { jobId },
        });
        result.scheduled += 1;
      } catch {
        result.failed += 1;
      }
    }

    cursor = constructions[constructions.length - 1].id;
    if (constructions.length < batchSize) break;
  }

  return result;
}

export interface BuildingReconciliationLoop {
  runNow(): Promise<boolean>;
  stop(): void;
}

export interface BuildingReconciliationTimer {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export function startBuildingReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = BUILDING_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): BuildingReconciliationLoop {
  let running = false;

  const runNow = async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    try {
      await reconcile();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
    return true;
  };

  const interval = timer.setInterval(() => {
    void runNow();
  }, intervalMs);
  void runNow();

  return {
    runNow,
    stop: () => timer.clearInterval(interval),
  };
}

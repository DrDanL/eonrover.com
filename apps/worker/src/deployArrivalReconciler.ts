import { PrismaClient } from '@prisma/client';
import {
  completeOwnedPlanetDeployArrival,
  DeployArrivalCompletionOutcome,
  scheduleDeployArrivalWakeup,
  DeployArrivalSchedulingOutcome,
  DeployArrivalSchedulingQueue,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const DEPLOY_ARRIVAL_RECONCILIATION_INTERVAL_MS = 30_000;
export const DEPLOY_ARRIVAL_RECONCILIATION_BATCH_SIZE = 100;

export interface DeployArrivalReconciliationResult {
  scanned: number;
  completed: number;
  scheduled: number;
  existing: number;
  skipped: number;
  failed: number;
}

type CompleteArrival = (missionId: string, currentTime: Date) => Promise<DeployArrivalCompletionOutcome>;
type ScheduleArrival = (missionId: string, currentTime: Date) => Promise<DeployArrivalSchedulingOutcome>;

/**
 * Repairs only canonical outbound DEPLOY wake-ups. PostgreSQL remains the
 * authority for eligibility, due time, transition, inventory and notices.
 */
export async function reconcilePendingDeployArrivalJobs(
  database: PrismaClient,
  queue: DeployArrivalSchedulingQueue,
  currentTime = new Date(),
  batchSize = DEPLOY_ARRIVAL_RECONCILIATION_BATCH_SIZE,
  complete: CompleteArrival = (missionId, now) => completeOwnedPlanetDeployArrival(database, missionId, now),
  schedule: ScheduleArrival = (missionId, now) => scheduleDeployArrivalWakeup(database, queue, missionId, now),
): Promise<DeployArrivalReconciliationResult> {
  const result: DeployArrivalReconciliationResult = {
    scanned: 0, completed: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0,
  };
  const missions = await database.fleetMission.findMany({
    where: { missionType: 'DEPLOY', status: 'OUTBOUND' },
    orderBy: { id: 'asc' },
    take: Math.min(batchSize, DEPLOY_ARRIVAL_RECONCILIATION_BATCH_SIZE),
    select: { id: true, arrivesAt: true },
  });

  for (const mission of missions) {
    result.scanned += 1;
    try {
      if (mission.arrivesAt <= currentTime) {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'completed') result.completed += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
        continue;
      }

      const outcome = await schedule(mission.id, currentTime);
      if (outcome === 'scheduled') result.scheduled += 1;
      else if (outcome === 'existing') result.existing += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export interface DeployArrivalReconciliationLoop {
  runNow(): Promise<boolean>;
  stop(): void;
}

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Starts immediately, runs every 30 seconds, and skips overlapping passes. */
export function startDeployArrivalReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = DEPLOY_ARRIVAL_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): DeployArrivalReconciliationLoop {
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

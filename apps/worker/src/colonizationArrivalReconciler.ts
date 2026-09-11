import { PrismaClient } from '@prisma/client';
import {
  ColonizationArrivalSchedulingOutcome,
  ColonizationArrivalSchedulingQueue,
  ColonizationCompletionOutcome,
  completeCanonicalColonization,
  scheduleColonizationArrivalWakeup,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const COLONIZATION_ARRIVAL_RECONCILIATION_INTERVAL_MS = 30_000;
export const COLONIZATION_ARRIVAL_RECONCILIATION_BATCH_SIZE = 100;

export interface ColonizationArrivalReconciliationResult {
  scanned: number;
  completed: number;
  scheduled: number;
  existing: number;
  skipped: number;
  failed: number;
}

type CompleteArrival = (missionId: string, currentTime: Date) => Promise<ColonizationCompletionOutcome>;
type ScheduleArrival = (missionId: string, currentTime: Date) => Promise<ColonizationArrivalSchedulingOutcome>;

/**
 * Repairs only canonical outbound COLONIZE wake-ups. PostgreSQL remains the
 * authority for eligibility, timing, colony creation, terminal outcomes, and
 * notifications; Redis is solely a deterministic wake-up mechanism.
 */
export async function reconcilePendingColonizationArrivalJobs(
  database: PrismaClient,
  queue: ColonizationArrivalSchedulingQueue,
  currentTime = new Date(),
  batchSize = COLONIZATION_ARRIVAL_RECONCILIATION_BATCH_SIZE,
  complete: CompleteArrival = (missionId, now) => completeCanonicalColonization(database, missionId, now),
  schedule: ScheduleArrival = (missionId, now) => scheduleColonizationArrivalWakeup(database, queue, missionId, now),
): Promise<ColonizationArrivalReconciliationResult> {
  const result: ColonizationArrivalReconciliationResult = {
    scanned: 0, completed: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0,
  };
  const missions = await database.fleetMission.findMany({
    where: { missionType: 'COLONIZE', status: 'OUTBOUND' },
    orderBy: { id: 'asc' },
    take: Math.min(batchSize, COLONIZATION_ARRIVAL_RECONCILIATION_BATCH_SIZE),
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

export interface ColonizationArrivalReconciliationLoop {
  runNow(): Promise<boolean>;
  stop(): void;
}

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Starts immediately, repeats every 30 seconds, and never overlaps passes. */
export function startColonizationArrivalReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = COLONIZATION_ARRIVAL_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): ColonizationArrivalReconciliationLoop {
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

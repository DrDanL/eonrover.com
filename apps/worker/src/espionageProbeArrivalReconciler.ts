import { PrismaClient } from '@prisma/client';
import {
  EspionageProbeCompletionOutcome,
  EspionageProbeSchedulingOutcome,
  EspionageProbeSchedulingQueue,
  scheduleEspionageProbeArrivalWakeup,
  scheduleEspionageProbeReturnWakeup,
  settleCanonicalEspionageProbe,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_INTERVAL_MS = 30_000;
export const ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_BATCH_SIZE = 100;

export interface EspionageProbeArrivalReconciliationResult {
  scanned: number;
  completed: number;
  scheduled: number;
  existing: number;
  skipped: number;
  failed: number;
}

type CompleteProbe = (missionId: string, currentTime: Date) => Promise<EspionageProbeCompletionOutcome>;
type ScheduleProbe = (missionId: string, currentTime: Date) => Promise<EspionageProbeSchedulingOutcome>;

/**
 * Recovers only active canonical Probe lifecycle wake-ups. PostgreSQL owns
 * phase, due time, report state, inventory, and notifications; Redis is only
 * restored as the matching deterministic future wake-up.
 */
export async function reconcilePendingEspionageProbeArrivalJobs(
  database: PrismaClient,
  queue: EspionageProbeSchedulingQueue,
  currentTime = new Date(),
  batchSize = ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_BATCH_SIZE,
  complete: CompleteProbe = (missionId, now) => settleCanonicalEspionageProbe(database, missionId, now, {
    scheduleReturnWakeup: (id, scheduledAt) => scheduleEspionageProbeReturnWakeup(database, queue, id, scheduledAt),
  }),
  scheduleArrival: ScheduleProbe = (missionId, now) => scheduleEspionageProbeArrivalWakeup(database, queue, missionId, now),
  scheduleReturn: ScheduleProbe = (missionId, now) => scheduleEspionageProbeReturnWakeup(database, queue, missionId, now),
): Promise<EspionageProbeArrivalReconciliationResult> {
  const result: EspionageProbeArrivalReconciliationResult = {
    scanned: 0, completed: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0,
  };
  const missions = await database.fleetMission.findMany({
    where: {
      missionType: 'ESPIONAGE',
      status: { in: ['OUTBOUND', 'RETURNING'] },
      espionageProbePhase: { in: ['OUTBOUND', 'RETURNING'] },
    },
    orderBy: { id: 'asc' },
    take: Math.min(batchSize, ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_BATCH_SIZE),
    select: { id: true, espionageProbePhase: true, arrivesAt: true, returnsAt: true },
  });

  // PostgreSQL honors `take`, but retaining the cap here keeps the bounded
  // contract intact for every Prisma-compatible caller and test double.
  for (const mission of missions.slice(0, ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_BATCH_SIZE)) {
    result.scanned += 1;
    try {
      const isArrival = mission.espionageProbePhase === 'OUTBOUND';
      const dueAt = isArrival ? mission.arrivesAt : mission.returnsAt;
      if (!dueAt || !Number.isFinite(dueAt.getTime())) {
        result.skipped += 1;
        continue;
      }
      if (dueAt <= currentTime) {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'arrived' || outcome === 'returned') result.completed += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
        continue;
      }

      const outcome = await (isArrival ? scheduleArrival : scheduleReturn)(mission.id, currentTime);
      if (outcome === 'scheduled') result.scheduled += 1;
      else if (outcome === 'existing' || outcome === 'retained-terminal') result.existing += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export interface EspionageProbeArrivalReconciliationLoop {
  runNow(): Promise<boolean>;
  stop(): void;
}

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Starts immediately, repeats every 30 seconds, and never overlaps runs. */
export function startEspionageProbeArrivalReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = ESPIONAGE_PROBE_ARRIVAL_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): EspionageProbeArrivalReconciliationLoop {
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

import { PrismaClient } from '@prisma/client';
import {
  scheduleTransportArrivalWakeup,
  scheduleTransportReturnWakeup,
  settleCanonicalTransport,
  TransportCompletionOutcome,
  TransportSchedulingOutcome,
  TransportSchedulingQueue,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const TRANSPORT_ARRIVAL_RECONCILIATION_INTERVAL_MS = 30_000;
export const TRANSPORT_ARRIVAL_RECONCILIATION_BATCH_SIZE = 100;

export interface TransportArrivalReconciliationResult {
  scanned: number;
  settled: number;
  scheduled: number;
  existing: number;
  skipped: number;
  failed: number;
}

type CompleteTransport = (missionId: string, currentTime: Date) => Promise<TransportCompletionOutcome>;
type ScheduleTransport = (missionId: string, currentTime: Date) => Promise<TransportSchedulingOutcome>;

/**
 * Reconciles only active canonical TRANSPORT rows. PostgreSQL decides phase,
 * due time, inventory, cargo, resources, and notifications; Redis is merely
 * restored as a deterministic future wake-up.
 */
export async function reconcilePendingTransportArrivalJobs(
  database: PrismaClient,
  queue: TransportSchedulingQueue,
  currentTime = new Date(),
  batchSize = TRANSPORT_ARRIVAL_RECONCILIATION_BATCH_SIZE,
  complete: CompleteTransport = (missionId, now) => settleCanonicalTransport(database, missionId, now, {
    scheduleReturnWakeup: (id, scheduledAt) => scheduleTransportReturnWakeup(database, queue, id, scheduledAt),
  }),
  scheduleArrival: ScheduleTransport = (missionId, now) => scheduleTransportArrivalWakeup(database, queue, missionId, now),
  scheduleReturn: ScheduleTransport = (missionId, now) => scheduleTransportReturnWakeup(database, queue, missionId, now),
): Promise<TransportArrivalReconciliationResult> {
  const result: TransportArrivalReconciliationResult = {
    scanned: 0, settled: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0,
  };
  const missions = await database.fleetMission.findMany({
    where: {
      missionType: 'TRANSPORT',
      status: { in: ['OUTBOUND', 'RETURNING'] },
      transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY', 'RETURNING'] },
    },
    orderBy: { id: 'asc' },
    take: Math.min(batchSize, TRANSPORT_ARRIVAL_RECONCILIATION_BATCH_SIZE),
    select: { id: true, transportPhase: true, arrivesAt: true, returnsAt: true },
  });

  for (const mission of missions) {
    result.scanned += 1;
    try {
      if (mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY') {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'delivered' || outcome === 'returned') result.settled += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
        continue;
      }

      const isArrival = mission.transportPhase === 'OUTBOUND';
      const dueAt = isArrival ? mission.arrivesAt : mission.transportPhase === 'RETURNING' ? mission.returnsAt : null;
      if (!dueAt || !Number.isFinite(dueAt.getTime())) {
        result.skipped += 1;
        continue;
      }
      if (dueAt <= currentTime) {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'delivered' || outcome === 'returned') result.settled += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
        continue;
      }

      const outcome = await (isArrival ? scheduleArrival : scheduleReturn)(mission.id, currentTime);
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

export interface TransportArrivalReconciliationLoop {
  runNow(): Promise<boolean>;
  stop(): void;
}

const systemTimer: BuildingReconciliationTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Starts immediately, repeats every 30 seconds, and skips overlapping scans. */
export function startTransportArrivalReconciliation(
  reconcile: () => Promise<unknown>,
  intervalMs = TRANSPORT_ARRIVAL_RECONCILIATION_INTERVAL_MS,
  onError: (error: unknown) => void = () => undefined,
  timer: BuildingReconciliationTimer = systemTimer,
): TransportArrivalReconciliationLoop {
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

import { PrismaClient } from '@prisma/client';
import {
  CorvetteStrikeCompletionOutcome,
  CorvetteStrikeSchedulingOutcome,
  CorvetteStrikeSchedulingQueue,
  scheduleCorvetteStrikeArrivalWakeup,
  scheduleCorvetteStrikeReturnWakeup,
  settleCanonicalCorvetteStrike,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const CORVETTE_STRIKE_RECONCILIATION_INTERVAL_MS = 30_000;
export const CORVETTE_STRIKE_RECONCILIATION_BATCH_SIZE = 100;
export type CorvetteStrikeArrivalReconciliationResult = { scanned: number; completed: number; scheduled: number; existing: number; skipped: number; failed: number };
type Complete = (missionId: string, currentTime: Date) => Promise<CorvetteStrikeCompletionOutcome>;
type Schedule = (missionId: string, currentTime: Date) => Promise<CorvetteStrikeSchedulingOutcome>;

/** Bounded recovery for canonical active strikes only; legacy ATTACK rows are never selected. */
export async function reconcilePendingCorvetteStrikeArrivalJobs(
  database: PrismaClient,
  queue: CorvetteStrikeSchedulingQueue,
  currentTime = new Date(),
  batchSize = CORVETTE_STRIKE_RECONCILIATION_BATCH_SIZE,
  complete: Complete = (id, now) => settleCanonicalCorvetteStrike(database, id, now, { scheduleReturnWakeup: (missionId, at) => scheduleCorvetteStrikeReturnWakeup(database, queue, missionId, at) }),
  arrival: Schedule = (id, now) => scheduleCorvetteStrikeArrivalWakeup(database, queue, id, now),
  returning: Schedule = (id, now) => scheduleCorvetteStrikeReturnWakeup(database, queue, id, now),
): Promise<CorvetteStrikeArrivalReconciliationResult> {
  const result: CorvetteStrikeArrivalReconciliationResult = { scanned: 0, completed: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0 };
  const missions = await database.fleetMission.findMany({ where: { missionType: 'ATTACK', status: { in: ['OUTBOUND', 'RETURNING'] }, corvetteStrikePhase: { in: ['OUTBOUND', 'RETURNING'] }, corvetteStrikeOriginPlanetId: { not: null }, corvetteStrikeTargetPlanetId: { not: null }, corvetteStrikeAttackerId: { not: null }, corvetteStrikeDefenderId: { not: null } }, orderBy: { id: 'asc' }, take: Math.min(batchSize, CORVETTE_STRIKE_RECONCILIATION_BATCH_SIZE), select: { id: true, corvetteStrikePhase: true, arrivesAt: true, returnsAt: true } });
  for (const mission of missions.slice(0, CORVETTE_STRIKE_RECONCILIATION_BATCH_SIZE)) {
    result.scanned += 1;
    try {
      const dueAt = mission.corvetteStrikePhase === 'OUTBOUND' ? mission.arrivesAt : mission.returnsAt;
      if (!dueAt || !Number.isFinite(dueAt.getTime())) { result.skipped += 1; continue; }
      if (dueAt <= currentTime) {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'arrived' || outcome === 'returned') result.completed += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
      } else {
        const outcome = await (mission.corvetteStrikePhase === 'OUTBOUND' ? arrival : returning)(mission.id, currentTime);
        if (outcome === 'scheduled') result.scheduled += 1;
        else if (outcome === 'existing' || outcome === 'retained-terminal') result.existing += 1;
        else if (outcome === 'failed') result.failed += 1;
        else result.skipped += 1;
      }
    } catch { result.failed += 1; }
  }
  return result;
}
export interface CorvetteStrikeArrivalReconciliationLoop { runNow(): Promise<boolean>; stop(): void; }
const timer: BuildingReconciliationTimer = { setInterval: (callback, interval) => setInterval(callback, interval), clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout) };
/** Starts once immediately, repeats every 30 seconds, and prevents overlap. */
export function startCorvetteStrikeArrivalReconciliation(reconcile: () => Promise<unknown>, intervalMs = CORVETTE_STRIKE_RECONCILIATION_INTERVAL_MS, onError: (error: unknown) => void = () => undefined, systemTimer: BuildingReconciliationTimer = timer): CorvetteStrikeArrivalReconciliationLoop {
  let running = false;
  const runNow = async () => { if (running) return false; running = true; try { await reconcile(); } catch (error) { onError(error); } finally { running = false; } return true; };
  const interval = systemTimer.setInterval(() => { void runNow(); }, intervalMs);
  void runNow();
  return { runNow, stop: () => systemTimer.clearInterval(interval) };
}

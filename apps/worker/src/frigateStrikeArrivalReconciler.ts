import { PrismaClient } from '@prisma/client';
import {
  FrigateStrikeCompletionOutcome,
  FrigateStrikeSchedulingOutcome,
  FrigateStrikeSchedulingQueue,
  scheduleFrigateStrikeArrivalWakeup,
  scheduleFrigateStrikeReturnWakeup,
  settleCanonicalFrigateStrike,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';

export const FRIGATE_STRIKE_RECONCILIATION_INTERVAL_MS = 30_000;
export const FRIGATE_STRIKE_RECONCILIATION_BATCH_SIZE = 100;
export type FrigateStrikeArrivalReconciliationResult = { scanned: number; completed: number; scheduled: number; existing: number; skipped: number; failed: number };
type Complete = (missionId: string, currentTime: Date) => Promise<FrigateStrikeCompletionOutcome>;
type Schedule = (missionId: string, currentTime: Date) => Promise<FrigateStrikeSchedulingOutcome>;

/** Recovery selects only complete canonical Frigate snapshots; legacy ATTACK rows stay dormant. */
export async function reconcilePendingFrigateStrikeArrivalJobs(
  database: PrismaClient,
  queue: FrigateStrikeSchedulingQueue,
  currentTime = new Date(),
  batchSize = FRIGATE_STRIKE_RECONCILIATION_BATCH_SIZE,
  complete: Complete = (id, now) => settleCanonicalFrigateStrike(database, id, now, { scheduleReturnWakeup: (missionId, at) => scheduleFrigateStrikeReturnWakeup(database, queue, missionId, at) }),
  arrival: Schedule = (id, now) => scheduleFrigateStrikeArrivalWakeup(database, queue, id, now),
  returning: Schedule = (id, now) => scheduleFrigateStrikeReturnWakeup(database, queue, id, now),
): Promise<FrigateStrikeArrivalReconciliationResult> {
  const result: FrigateStrikeArrivalReconciliationResult = { scanned: 0, completed: 0, scheduled: 0, existing: 0, skipped: 0, failed: 0 };
  const missions = await database.fleetMission.findMany({ where: { missionType: 'ATTACK', status: { in: ['OUTBOUND', 'RETURNING'] }, frigateStrikePhase: { in: ['OUTBOUND', 'RETURNING'] }, frigateStrikeOriginPlanetId: { not: null }, frigateStrikeTargetPlanetId: { not: null }, frigateStrikeAttackerId: { not: null }, frigateStrikeDefenderId: { not: null } }, orderBy: { id: 'asc' }, take: Math.min(batchSize, FRIGATE_STRIKE_RECONCILIATION_BATCH_SIZE), select: { id: true, frigateStrikePhase: true, arrivesAt: true, returnsAt: true } });
  for (const mission of missions) {
    result.scanned += 1;
    try {
      const dueAt = mission.frigateStrikePhase === 'OUTBOUND' ? mission.arrivesAt : mission.returnsAt;
      if (!dueAt || !Number.isFinite(dueAt.getTime())) { result.skipped += 1; continue; }
      if (dueAt <= currentTime) {
        const outcome = await complete(mission.id, currentTime);
        if (outcome === 'arrived' || outcome === 'returned') result.completed += 1;
        else if (outcome === 'unavailable') result.failed += 1;
        else result.skipped += 1;
      } else {
        const outcome = await (mission.frigateStrikePhase === 'OUTBOUND' ? arrival : returning)(mission.id, currentTime);
        if (outcome === 'scheduled') result.scheduled += 1;
        else if (outcome === 'existing' || outcome === 'retained-terminal') result.existing += 1;
        else if (outcome === 'failed') result.failed += 1;
        else result.skipped += 1;
      }
    } catch { result.failed += 1; }
  }
  return result;
}
export interface FrigateStrikeArrivalReconciliationLoop { runNow(): Promise<boolean>; stop(): void; }
const timer: BuildingReconciliationTimer = { setInterval: (callback, interval) => setInterval(callback, interval), clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout) };
/** Starts immediately and repeats every thirty seconds without overlapping calls. */
export function startFrigateStrikeArrivalReconciliation(reconcile: () => Promise<unknown>, intervalMs = FRIGATE_STRIKE_RECONCILIATION_INTERVAL_MS, onError: (error: unknown) => void = () => undefined, systemTimer: BuildingReconciliationTimer = timer): FrigateStrikeArrivalReconciliationLoop {
  let running = false;
  const runNow = async () => { if (running) return false; running = true; try { await reconcile(); } catch (error) { onError(error); } finally { running = false; } return true; };
  const interval = systemTimer.setInterval(() => { void runNow(); }, intervalMs);
  void runNow();
  return { runNow, stop: () => systemTimer.clearInterval(interval) };
}

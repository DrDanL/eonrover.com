import { Queue } from 'bullmq';
import { completeShipyardBatch, isActiveShipyardDefenceKey } from '@eonrover/shared';

export const SHIPYARD_RECONCILIATION_INTERVAL_MS = 30_000;
export const SHIPYARD_RECONCILIATION_BATCH_SIZE = 100;
export const SHIPYARD_COMPLETION_JOB_NAME = 'complete-shipyard-unit';
export function shipyardCompletionJobId(queueItemId: string): string { return `ship-${queueItemId}`; }

type Database = { shipyardQueueItem: any } & Parameters<typeof completeShipyardBatch>[0];
type CompletionQueue = Pick<Queue, 'add' | 'getJob'>;
function isLive(state: string): boolean { return ['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'].includes(state); }
function isCanonicalQueueItem(item: { itemKey: string; itemType: string; canonicalDefenceKey?: string | null }): boolean {
  return (item.itemType === 'ship' && ['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'recycler', 'probe'].includes(item.itemKey))
    || (item.itemType === 'defence' && item.canonicalDefenceKey === item.itemKey && isActiveShipyardDefenceKey(item.itemKey));
}
export interface ShipyardReconciliationResult { scanned: number; completed: number; scheduled: number; existing: number; failed: number; }

export async function reconcilePendingShipyardJobs(database: Database, queue: CompletionQueue, now = new Date(), batchSize = SHIPYARD_RECONCILIATION_BATCH_SIZE): Promise<ShipyardReconciliationResult> {
  const result: ShipyardReconciliationResult = { scanned: 0, completed: 0, scheduled: 0, existing: 0, failed: 0 };
  const pending = await database.shipyardQueueItem.findMany({ where: { status: 'PENDING' }, orderBy: { id: 'asc' }, take: batchSize, select: { id: true, itemKey: true, itemType: true, canonicalDefenceKey: true, completesAt: true } });
  for (const item of pending) {
    result.scanned += 1;
    try {
      if (!isCanonicalQueueItem(item)) continue;
      if (item.completesAt <= now) { if (await completeShipyardBatch(database, item.id, now) === 'completed') result.completed += 1; continue; }
      const jobId = shipyardCompletionJobId(item.id); const existing = await queue.getJob(jobId);
      if (existing && isLive(await existing.getState())) { result.existing += 1; continue; }
      if (existing) await existing.remove();
      await queue.add(SHIPYARD_COMPLETION_JOB_NAME, { queueItemId: item.id }, { jobId, delay: Math.max(0, item.completesAt.getTime() - now.getTime()), removeOnComplete: true, attempts: 3 });
      await database.shipyardQueueItem.updateMany({ where: { id: item.id, status: 'PENDING' }, data: { jobId } }); result.scheduled += 1;
    } catch { result.failed += 1; }
  }
  return result;
}

export function startShipyardReconciliation(reconcile: () => Promise<unknown>, intervalMs = SHIPYARD_RECONCILIATION_INTERVAL_MS, onError: (error: unknown) => void = () => {}) {
  let running = false;
  const run = async () => { if (running) return; running = true; try { await reconcile(); } catch (error) { onError(error); } finally { running = false; } };
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);
  return { stop: () => clearInterval(timer), run };
}

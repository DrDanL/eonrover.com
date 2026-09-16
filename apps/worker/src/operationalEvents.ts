export type OperationalEventName =
  | 'worker.configuration_invalid'
  | 'worker.started'
  | 'worker.queue_registered'
  | 'worker.job_completed'
  | 'worker.job_failed'
  | 'worker.reconciliation_started'
  | 'worker.reconciliation_completed'
  | 'worker.reconciliation_failed';

export type OperationalEvent = Readonly<{
  event: OperationalEventName;
  queue?: string;
  reconciliation?: string;
  counts?: Readonly<Record<string, number>>;
}>;

export type OperationalEventSink = (line: string) => void;

const SAFE_COUNT_KEYS = new Set(['scanned', 'completed', 'scheduled', 'existing', 'skipped', 'failed']);

export function reconciliationCounts(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (SAFE_COUNT_KEYS.has(key) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
      counts[key] = count;
    }
  }
  return Object.keys(counts).length > 0 ? Object.freeze(counts) : undefined;
}

export function emitOperationalEvent(event: OperationalEvent, sink: OperationalEventSink = console.log): void {
  sink(JSON.stringify(event));
}

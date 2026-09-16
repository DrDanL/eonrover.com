export type OperationalEventName =
  | 'worker.configuration_invalid'
  | 'worker.started'
  | 'worker.queue_registered'
  | 'worker.job_completed'
  | 'worker.job_failed'
  | 'worker.reconciliation_started'
  | 'worker.reconciliation_completed'
  | 'worker.reconciliation_failed';

export type WorkerOperationFamily =
  | 'worker'
  | 'canonical-queues'
  | 'build'
  | 'research'
  | 'shipyard'
  | 'deploy-arrival'
  | 'colonization-arrival'
  | 'transport-arrival'
  | 'espionage-probe-arrival'
  | 'corvette-strike-arrival'
  | 'frigate-strike-arrival';

export type OperationalStatus = 'started' | 'registered' | 'completed' | 'failed';

export type OperationalEvent = Readonly<{
  event: OperationalEventName;
  component?: WorkerOperationFamily;
  status?: OperationalStatus;
  count?: number;
  counts?: Readonly<Record<string, number>>;
}>;

export type OperationalEventSink = (line: string) => void;

const SAFE_COUNT_KEYS = new Set(['scanned', 'completed', 'scheduled', 'existing', 'skipped', 'failed']);
const MAX_SAFE_OPERATIONAL_COUNT = 100;

const SAFE_COMPONENTS = new Set<WorkerOperationFamily>([
  'worker',
  'canonical-queues',
  'build',
  'research',
  'shipyard',
  'deploy-arrival',
  'colonization-arrival',
  'transport-arrival',
  'espionage-probe-arrival',
  'corvette-strike-arrival',
  'frigate-strike-arrival',
]);

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_SAFE_OPERATIONAL_COUNT
    ? value
    : undefined;
}

export function reconciliationCounts(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    const boundedCount = safeCount(count);
    if (SAFE_COUNT_KEYS.has(key) && boundedCount !== undefined) {
      counts[key] = boundedCount;
    }
  }
  return Object.keys(counts).length > 0 ? Object.freeze(counts) : undefined;
}

function projectOperationalEvent(event: OperationalEvent): Readonly<Record<string, unknown>> {
  switch (event.event) {
    case 'worker.started':
      return { event: event.event, component: 'worker', status: 'started' };
    case 'worker.configuration_invalid':
      return { event: event.event, component: 'worker', status: 'failed' };
    case 'worker.queue_registered': {
      const count = safeCount(event.count);
      return count === undefined
        ? { event: event.event, component: 'canonical-queues', status: 'registered' }
        : { event: event.event, component: 'canonical-queues', status: 'registered', count };
    }
    case 'worker.job_completed':
    case 'worker.job_failed': {
      const component = event.component && SAFE_COMPONENTS.has(event.component)
        ? event.component
        : 'worker';
      return {
        event: event.event,
        component,
        status: event.event === 'worker.job_completed' ? 'completed' : 'failed',
      };
    }
    case 'worker.reconciliation_started':
    case 'worker.reconciliation_completed':
    case 'worker.reconciliation_failed': {
      const component = event.component && SAFE_COMPONENTS.has(event.component)
        ? event.component
        : 'worker';
      const status = event.event === 'worker.reconciliation_started'
        ? 'started'
        : event.event === 'worker.reconciliation_completed'
          ? 'completed'
          : 'failed';
      const counts = event.event === 'worker.reconciliation_completed'
        ? reconciliationCounts(event.counts)
        : undefined;
      return counts
        ? { event: event.event, component, status, counts }
        : { event: event.event, component, status };
    }
  }
}

export function emitOperationalEvent(event: OperationalEvent, sink: OperationalEventSink = console.log): void {
  sink(JSON.stringify(projectOperationalEvent(event)));
}

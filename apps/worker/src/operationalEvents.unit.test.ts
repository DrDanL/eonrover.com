import { emitOperationalEvent, reconciliationCounts, type OperationalEvent } from './operationalEvents';

const FORBIDDEN_DETAILS = [
  'jobId',
  'missionId',
  'frigate-strike-arrival-queue',
  'corvette-strike-arrival-queue',
  'fleet-queue',
  'mission-uuid-1234',
  'postgresql://user:secret@private-db:5432/eonrover',
  'redis failure text',
  'payload-value',
];

function emittedLine(event: OperationalEvent | Record<string, unknown>): Record<string, unknown> {
  const sink = jest.fn();
  emitOperationalEvent(event as OperationalEvent, sink);
  return JSON.parse(sink.mock.calls[0][0]);
}

describe('worker operational events', () => {
  it('projects startup, registration, completion, failure, and reconciliation events to strict safe JSON lines', () => {
    const events: Array<OperationalEvent | Record<string, unknown>> = [
      { event: 'worker.started', queue: 'frigate-strike-arrival-queue', jobId: 'mission-uuid-1234' },
      { event: 'worker.queue_registered', queueName: 'corvette-strike-arrival-queue', count: 9 },
      { event: 'worker.job_completed', component: 'frigate-strike-arrival', missionId: 'mission-uuid-1234' },
      {
        event: 'worker.job_failed',
        component: 'corvette-strike-arrival',
        error: { message: 'redis failure text', stack: 'payload-value' },
      },
      { event: 'worker.reconciliation_started', component: 'frigate-strike-arrival', queue: 'fleet-queue' },
      {
        event: 'worker.reconciliation_completed',
        component: 'frigate-strike-arrival',
        counts: { scanned: 4, completed: 1, missionId: 'forged', seed: 'payload-value' },
      },
      {
        event: 'worker.reconciliation_failed',
        component: 'frigate-strike-arrival',
        error: { message: 'postgresql://user:secret@private-db:5432/eonrover' },
      },
    ];

    const lines = events.map(emittedLine);

    expect(lines).toEqual([
      { event: 'worker.started', component: 'worker', status: 'started' },
      { event: 'worker.queue_registered', component: 'canonical-queues', status: 'registered', count: 9 },
      { event: 'worker.job_completed', component: 'frigate-strike-arrival', status: 'completed' },
      { event: 'worker.job_failed', component: 'corvette-strike-arrival', status: 'failed' },
      { event: 'worker.reconciliation_started', component: 'frigate-strike-arrival', status: 'started' },
      {
        event: 'worker.reconciliation_completed',
        component: 'frigate-strike-arrival',
        status: 'completed',
        counts: { scanned: 4, completed: 1 },
      },
      { event: 'worker.reconciliation_failed', component: 'frigate-strike-arrival', status: 'failed' },
    ]);

    for (const line of lines) {
      const serialized = JSON.stringify(line);
      for (const forbidden of FORBIDDEN_DETAILS) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(line).not.toHaveProperty('queue');
      expect(line).not.toHaveProperty('queueName');
      expect(line).not.toHaveProperty('jobId');
      expect(line).not.toHaveProperty('missionId');
      expect(line).not.toHaveProperty('error');
    }
  });

  it('drops non-aggregate, unsafe, and unbounded reconciliation values', () => {
    expect(reconciliationCounts({ scanned: 1.5, failed: -1, report: 2, userId: 3 })).toBeUndefined();
    expect(reconciliationCounts({ scanned: 101, completed: 1 })).toEqual({ completed: 1 });
    expect(reconciliationCounts(null)).toBeUndefined();
  });
});

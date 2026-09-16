import { emitOperationalEvent, reconciliationCounts } from './operationalEvents';

describe('worker operational events', () => {
  it('emits structured queue and reconciliation events without sensitive payload data', () => {
    const sink = jest.fn();
    emitOperationalEvent({
      event: 'worker.reconciliation_completed',
      reconciliation: 'corvette-strike-arrival',
      counts: reconciliationCounts({ scanned: 4, completed: 1, missionId: 'forged', seed: 'secret' }),
    }, sink);

    expect(sink).toHaveBeenCalledWith(JSON.stringify({
      event: 'worker.reconciliation_completed',
      reconciliation: 'corvette-strike-arrival',
      counts: { scanned: 4, completed: 1 },
    }));
    expect(sink.mock.calls[0][0]).not.toMatch(/forged|secret|missionId|seed/i);
  });

  it('drops non-aggregate, invalid, and sensitive-looking reconciliation values', () => {
    expect(reconciliationCounts({ scanned: 1.5, failed: -1, report: 2, userId: 3 })).toBeUndefined();
    expect(reconciliationCounts(null)).toBeUndefined();
  });
});

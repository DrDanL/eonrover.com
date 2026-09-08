import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('legacy fleet worker containment', () => {
  it('does not register a Fleet BullMQ consumer, preserving queued jobs without mutation', () => {
    const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(source).not.toContain("new Worker('fleet-queue'");
    expect(source).not.toContain('processFleetJob');
    expect(source).toContain("new Worker('deploy-arrival-queue'");
    expect(source).toContain('startDeployArrivalReconciliation');
    expect(source).toContain('reconcilePendingDeployArrivalJobs');
  });
});

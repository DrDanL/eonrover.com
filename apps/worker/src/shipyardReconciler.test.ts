import { completeShipyardBatch } from '@eonrover/shared';
import { prisma } from './prisma';
import { reconcilePendingShipyardJobs, shipyardCompletionJobId } from './shipyardReconciler';
import { processShipyardJob } from './processors/shipyardProcessor';

const NOW = new Date('2026-09-08T12:00:00.000Z'); let slot = 1;
async function fixture(completesAt = NOW, quantity = 3) {
  const n = slot++; const user = await prisma.user.create({ data: { email: `ship-complete-${n}@example.com`, username: `ship-complete-${n}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const planet = await prisma.planet.create({ data: { ownerId: user.id, name: `Ship ${n}`, galaxy: 7, system: 7, slot: n, planetType: 'TEMPERATE', temperature: 1, solarIndex: 1, alloy: 0, heliox: 0, aether: 0, lastProductionAt: NOW } });
  const item = await prisma.shipyardQueueItem.create({ data: { planetId: planet.id, itemKey: 'scout', itemType: 'ship', quantity, remaining: quantity, costAlloy: 1, costHeliox: 1, costAether: 0, durationSeconds: 60, completesAt } });
  return { user, planet, item };
}
describe('Shipyard authoritative completion and recovery', () => {
  it('increments a missing inventory row by the persisted accepted quantity exactly once', async () => {
    const f = await fixture();
    expect(await completeShipyardBatch(prisma, f.item.id, NOW)).toBe('completed');
    expect(await completeShipyardBatch(prisma, f.item.id, NOW)).toBe('complete');
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: f.planet.id, key: 'scout' } } })).toMatchObject({ count: 3 });
    expect(await prisma.notification.count({ where: { userId: f.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
  });
  it('reconciles overdue completion and restores only the deterministic missing future job', async () => {
    const overdue = await fixture(new Date(NOW.getTime() - 1)); const future = await fixture(new Date(NOW.getTime() + 60_000));
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }), getJob: jest.fn().mockResolvedValue(undefined) };
    const result = await reconcilePendingShipyardJobs(prisma, queue as never, NOW);
    expect(result).toMatchObject({ scanned: 2, completed: 1, scheduled: 1 });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: overdue.item.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(queue.add).toHaveBeenCalledWith('complete-shipyard-unit', { queueItemId: future.item.id }, expect.objectContaining({ jobId: shipyardCompletionJobId(future.item.id) }));
  });
  it('reschedules an early forged Redis delivery at the persisted due time without side effects', async () => {
    const f = await fixture(new Date(NOW.getTime() + 60_000), 4);
    const job = { data: { queueItemId: f.item.id, userId: 'forged', planetId: 'wrong', shipKey: 'probe', quantity: 999 }, token: 'token', moveToDelayed: jest.fn() };
    await processShipyardJob(job as never);
    expect(job.moveToDelayed).toHaveBeenCalledWith(f.item.completesAt.getTime(), 'token');
    expect(await prisma.ship.count({ where: { planetId: f.planet.id } })).toBe(0);
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: f.item.id } })).toMatchObject({ status: 'PENDING' });
    expect(await prisma.notification.count({ where: { userId: f.user.id } })).toBe(0);
  });
  it('ignores forged payload ownership, target and quantity after the persisted row is due', async () => {
    const f = await fixture(new Date(Date.now() - 1), 4);
    const job = { data: { queueItemId: f.item.id, userId: 'forged', planetId: 'wrong', shipKey: 'probe', itemType: 'defence', quantity: 999 }, token: 'x', moveToDelayed: jest.fn() };
    await processShipyardJob(job as never);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: f.planet.id, key: 'scout' } } })).toMatchObject({ count: 4 });
    expect(await prisma.ship.count({ where: { key: 'probe' } })).toBe(0);
  });
});

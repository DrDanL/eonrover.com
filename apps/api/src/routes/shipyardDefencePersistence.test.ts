import { prisma } from '../lib/prisma';

describe('canonical Shipyard defence marker persistence', () => {
  it('keeps a representative legacy defence row readable and only permits the named canonical Flak marker', async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "migration_name" = '20260914100000_add_canonical_shipyard_defence_marker'
    `;
    expect(migrations).toEqual([{ migration_name: '20260914100000_add_canonical_shipyard_defence_marker' }]);
    const user = await prisma.user.create({ data: { email: 'shipyard-defence-marker@example.invalid', username: 'shipyard-defence-marker', passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
    const planet = await prisma.planet.create({ data: { ownerId: user.id, name: 'Marker', galaxy: 6, system: 6, slot: 6, planetType: 'TEMPERATE', temperature: 0, solarIndex: 0.7 } });
    const legacy = await prisma.shipyardQueueItem.create({ data: { planetId: planet.id, itemKey: 'railBattery', itemType: 'defence', quantity: 1, remaining: 1, costAlloy: 6_000, costHeliox: 2_000, costAether: 0, durationSeconds: 1_500, status: 'COMPLETE', completesAt: new Date('2026-09-14T00:00:00.000Z') } });
    expect(legacy).toMatchObject({ itemKey: 'railBattery', itemType: 'defence', canonicalDefenceKey: null, costAlloy: 6_000, costHeliox: 2_000, durationSeconds: 1_500 });
    await expect(prisma.shipyardQueueItem.create({ data: { planetId: planet.id, itemKey: 'railBattery', itemType: 'defence', canonicalDefenceKey: 'railBattery', quantity: 1, remaining: 1, costAlloy: 1, costHeliox: 0, costAether: 0, durationSeconds: 1, completesAt: new Date() } })).rejects.toThrow();
    await expect(prisma.shipyardQueueItem.create({ data: { planetId: planet.id, itemKey: 'flakTurret', itemType: 'defence', canonicalDefenceKey: 'flakTurret', quantity: 1, remaining: 1, costAlloy: 2_000, costHeliox: 0, costAether: 0, durationSeconds: 600, completesAt: new Date() } })).resolves.toMatchObject({ canonicalDefenceKey: 'flakTurret' });
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { shipyardQueue } from '../lib/redis';
import { completeShipyardBatch } from '@eonrover/shared';

const app = createApp();
let slot = 700;
async function player(name: string) {
  const user = await prisma.user.create({ data: { email: `${name}@example.com`, username: name, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const planet = await prisma.planet.create({ data: { ownerId: user.id, name: `${name} Prime`, galaxy: 9, system: 9, slot: slot++, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 1234, heliox: 567, aether: 89, buildings: { create: [{ key: 'solarArray', level: 1 }, { key: 'shipyard', level: 2 }] } } });
  const token = `shipyard-${user.id}`; await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 86400000) } });
  return { user, planet, cookie: `${SESSION_COOKIE}=${token}` };
}
describe('read-only Shipyard catalogue', () => {
  it('requires ownership, presents selected authoritative state and does not mutate legacy rows', async () => {
    const owner = await player('shipyard-owner'); const other = await player('shipyard-other');
    await prisma.ship.create({ data: { planetId: owner.planet.id, key: 'transporter', count: 3 } });
    const pending = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 2, remaining: 2, costAlloy: 4000, costHeliox: 2000, costAether: 0, durationSeconds: 600, completesAt: new Date(Date.now() + 60000), jobId: 'private-job' } });
    const completed = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'probe', itemType: 'ship', quantity: 1, remaining: 0, costAlloy: 800, costHeliox: 400, costAether: 0, durationSeconds: 300, status: 'COMPLETE', completesAt: new Date() } });
    const cancelled = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'recycler', itemType: 'ship', quantity: 1, remaining: 1, costAlloy: 5000, costHeliox: 3000, costAether: 0, durationSeconds: 600, status: 'CANCELLED', completesAt: new Date() } });
    await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).expect(401);
    await request(app).get(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(404);
    const response = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(Object.keys(response.body).sort()).toEqual(['activeQueue', 'catalog', 'categories', 'legacyQueue', 'selectedPlanet']);
    expect(response.body.activeQueue).toEqual(expect.objectContaining({ id: pending.id, shipKey: 'scout', shipName: 'Scout', quantity: 2, status: 'PENDING', cancellation: { refundPercentage: 50, refund: { alloy: 2000, heliox: 1000, aether: 0 } } }));
    expect(response.body.categories.map((item: { id: string }) => item.id)).toEqual(['civilian', 'combat', 'specialist']);
    expect(response.body.catalog.map((item: { id: string }) => item.id)).toEqual(['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'probe', 'recycler']);
    expect(response.body.selectedPlanet).toMatchObject({ id: owner.planet.id, shipyardLevel: 2, resources: { alloy: 1234, heliox: 567, aether: 89 } });
    expect(response.body.catalog.find((item: { id: string }) => item.id === 'transporter')).toMatchObject({ owned: 3 });
    expect(response.body.legacyQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: completed.id, status: 'COMPLETE' }),
      expect.objectContaining({ id: cancelled.id, status: 'CANCELLED' }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain('jobId');
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ remaining: 2, status: 'PENDING', jobId: 'private-job' });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: completed.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: cancelled.id } })).toMatchObject({ status: 'CANCELLED' });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ itemKey: 'scout', itemType: 'ship', quantity: 1 }).expect(400);
    expect(await prisma.shipyardQueueItem.count({ where: { planetId: owner.planet.id } })).toBe(3);
  });

  it('presents an active queue only to its planet, then clears it after completion or cancellation', async () => {
    const owner = await player('shipyard-active-contract');
    const otherPlanet = await prisma.planet.create({ data: { ownerId: owner.user.id, name: 'Second Shipyard', galaxy: 9, system: 8, slot: slot++, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 0, heliox: 0, aether: 0 } });
    const item = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 3, remaining: 3, costAlloy: 6000, costHeliox: 3000, costAether: 0, durationSeconds: 900, jobId: 'private-job', completesAt: new Date(Date.now() + 60000) } });
    const active = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(active.body.activeQueue).toEqual(expect.objectContaining({ id: item.id, shipKey: 'scout', shipName: 'Scout', quantity: 3, status: 'PENDING', cost: { alloy: 6000, heliox: 3000, aether: 0 }, durationSeconds: 900 }));
    expect(JSON.stringify(active.body.activeQueue)).not.toMatch(/jobId|remaining|itemType|planetId|userId|costAlloy|costHeliox|costAether/i);
    expect((await request(app).get(`/api/planets/${otherPlanet.id}/shipyard`).set('Cookie', owner.cookie).expect(200)).body.activeQueue).toBeNull();
    await prisma.shipyardQueueItem.update({ where: { id: item.id }, data: { completesAt: new Date(Date.now() - 1) } });
    const completed = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(completed.body.activeQueue).toBeNull();
    expect(completed.body.catalog.find((ship: { id: string }) => ship.id === 'scout')).toMatchObject({ owned: 3 });
    const cancellable = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'probe', itemType: 'ship', quantity: 1, remaining: 1, costAlloy: 800, costHeliox: 400, costAether: 0, durationSeconds: 60, completesAt: new Date(Date.now() + 60000) } });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${cancellable.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    const cancelled = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(cancelled.body.activeQueue).toBeNull();
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: before.alloy + 400, heliox: before.heliox + 200 });
  });

  it('starts one canonical batch with snapshots, ignores spoofed values, and cancels with one 50% refund', async () => {
    const owner = await player('shipyard-start');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 10000, heliox: 10000, aether: 10000 } });
    const started = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 2, cost: { alloy: 1 }, durationSeconds: 1, completesAt: '1970-01-01', statistics: { speed: 1 } }).expect(201);
    expect(started.body.queueItem).toMatchObject({ shipKey: 'scout', shipName: 'Scout', quantity: 2, cost: { alloy: 4000, heliox: 2000, aether: 0 }, durationSeconds: 900, status: 'PENDING' });
    expect(JSON.stringify(started.body)).not.toContain('jobId');
    const stored = await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: started.body.queueItem.id } });
    expect(stored).toMatchObject({ planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 2, remaining: 2, costAlloy: 4000, costHeliox: 2000, costAether: 0, durationSeconds: 900, status: 'PENDING' });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 6000, heliox: 8000, aether: 10000 });
    const cancelled = await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${stored.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    expect(cancelled.body).toEqual({ queueItem: { id: stored.id, status: 'CANCELLED' }, refund: { alloy: 2000, heliox: 1000, aether: 0 } });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${stored.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(409);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 8000, heliox: 9000, aether: 10000 });
  });

  it('enforces canonical validation, prerequisites, ownership, and one pending batch per planet', async () => {
    const owner = await player('shipyard-rules'); const other = await player('shipyard-rules-other');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 100000, heliox: 100000, aether: 100000 } });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'unknown', quantity: 1 }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 0 }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 101 }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'colonyShip', quantity: 1 }).expect(409);
    await request(app).post(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(404);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(201);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(409);
    await prisma.planet.update({ where: { id: other.planet.id }, data: { alloy: 10000, heliox: 10000, aether: 10000 } });
    await request(app).post(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', other.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(201);
  });

  it('accepts only one simultaneous batch and preserves PostgreSQL state when Redis scheduling fails', async () => {
    const owner = await player('shipyard-race');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 100000, heliox: 100000, aether: 100000 } });
    const start = () => request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 });
    const responses = await Promise.all([start(), start()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.shipyardQueueItem.count({ where: { planetId: owner.planet.id, status: 'PENDING' } })).toBe(1);
    const queued = await prisma.shipyardQueueItem.findFirstOrThrow({ where: { planetId: owner.planet.id, status: 'PENDING' } });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${queued.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    jest.spyOn(shipyardQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    const acceptedWithoutRedis = await start().expect(201);
    expect(acceptedWithoutRedis.body.scheduling).toBe('pending');
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: acceptedWithoutRedis.body.queueItem.id } })).toMatchObject({ status: 'PENDING', costAlloy: 2000, costHeliox: 1000 });
    jest.restoreAllMocks();
  });

  it('settles an overdue persisted batch once before presenting the catalogue', async () => {
    const owner = await player('shipyard-overdue');
    const item = await prisma.shipyardQueueItem.create({ data: {
      planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 3, remaining: 3,
      costAlloy: 6000, costHeliox: 3000, costAether: 0, durationSeconds: 900,
      completesAt: new Date(Date.now() - 1),
    } });
    const get = () => request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    const first = await get(); await get();
    expect(first.body.catalog.find((entry: { id: string }) => entry.id === 'scout')).toMatchObject({ owned: 3 });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: 'COMPLETE', remaining: 0 });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
  });
  it('settles overdue cancellation as completion with no refund', async () => {
    const owner = await player('shipyard-overdue-cancel');
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } });
    const item = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 2, remaining: 2, costAlloy: 2000, costHeliox: 1000, costAether: 0, durationSeconds: 60, completesAt: new Date(Date.now() - 1) } });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${item.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(409);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.planet.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: before.alloy, heliox: before.heliox });
  });
  it('serializes due completion against cancellation into one completion with no refund', async () => {
    const owner = await player('shipyard-due-race');
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } });
    const item = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 2, remaining: 2, costAlloy: 2000, costHeliox: 1000, costAether: 0, durationSeconds: 60, completesAt: new Date(Date.now() - 1) } });
    const [completion, cancellation] = await Promise.all([
      completeShipyardBatch(prisma, item.id),
      request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${item.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1'),
    ]);
    expect(['completed', 'complete']).toContain(completion);
    expect(cancellation.status).toBe(409);
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: 'COMPLETE', remaining: 0 });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.planet.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: before.alloy, heliox: before.heliox });
  });
});

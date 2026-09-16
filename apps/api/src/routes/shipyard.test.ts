import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { shipyardQueue } from '../lib/redis';
import { completeShipyardBatch, planCorvetteStrike, settleCanonicalCorvetteStrike } from '@eonrover/shared';

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
    expect(Object.keys(response.body).sort()).toEqual(['activeQueue', 'catalog', 'categories', 'defences', 'legacyQueue', 'selectedPlanet']);
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
    const started = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 2 }).expect(201);
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
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1, cost: { alloy: 1 } }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 0 }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 101 }).expect(400);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'colonyShip', quantity: 1 }).expect(409);
    await request(app).post(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(404);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(201);
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(409);
    await prisma.planet.update({ where: { id: other.planet.id }, data: { alloy: 10000, heliox: 10000, aether: 10000 } });
    await request(app).post(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', other.cookie).set('X-Eonrover-Client', '1').send({ key: 'scout', quantity: 1 }).expect(201);
  });

  it('accepts a Colony Ship with the completed Shipyard prerequisite and no planned research', async () => {
    const owner = await player('shipyard-colony-ship');
    await prisma.planet.update({
      where: { id: owner.planet.id },
      data: { alloy: 100_000, heliox: 100_000, aether: 100_000, lastProductionAt: new Date() },
    });
    await prisma.building.update({
      where: { planetId_key: { planetId: owner.planet.id, key: 'shipyard' } },
      data: { level: 4 },
    });
    await prisma.building.create({
      data: { planetId: owner.planet.id, key: 'alloyStorage', level: 1 },
    });

    const response = await request(app)
      .post(`/api/planets/${owner.planet.id}/shipyard`)
      .set('Cookie', owner.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'colonyShip', quantity: 1 })
      .expect(201);

    expect(response.body.queueItem).toMatchObject({ shipKey: 'colonyShip', quantity: 1, status: 'PENDING' });
    expect(await prisma.research.count({ where: { userId: owner.user.id, key: 'propulsionTheory' } })).toBe(0);
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

  it('starts, cancels, and completes only a canonical Flak Turret batch', async () => {
    const owner = await player('shipyard-flak');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 10_000, heliox: 5_000, aether: 1_000, lastProductionAt: new Date() } });
    const rejectedRail = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'railBattery', quantity: 1 }).expect(409);
    expect(rejectedRail.body.code).toBe('PREREQUISITES_NOT_MET');
    expect(await prisma.shipyardQueueItem.count()).toBe(0);

    const started = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'flakTurret', quantity: 2 }).expect(201);
    const queueItem = await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: started.body.queueItem.id } });
    expect(queueItem).toMatchObject({ itemKey: 'flakTurret', itemType: 'defence', canonicalDefenceKey: 'flakTurret', quantity: 2, costAlloy: 4000, costHeliox: 0, costAether: 0, durationSeconds: 600 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 6000, heliox: 5000, aether: 1000 });

    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${queueItem.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 8000, heliox: 5000, aether: 1000 });

    const accepted = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'flakTurret', quantity: 2 }).expect(201);
    await prisma.shipyardQueueItem.update({ where: { id: accepted.body.queueItem.id }, data: { completesAt: new Date(Date.now() - 1) } });
    await Promise.all([completeShipyardBatch(prisma, accepted.body.queueItem.id), completeShipyardBatch(prisma, accepted.body.queueItem.id)]);
    expect(await prisma.defence.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.planet.id, key: 'flakTurret' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
  });

  it('starts, cancels, and completes only a canonical Rail Battery batch after Shipyard and Weapon Technology prerequisites', async () => {
    const owner = await player('shipyard-rail');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 10_000, heliox: 5_000, aether: 1_000, lastProductionAt: new Date() } });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'railBattery', quantity: 1 }).expect(409);
    expect(await prisma.shipyardQueueItem.count({ where: { planetId: owner.planet.id } })).toBe(0);
    await prisma.building.update({ where: { planetId_key: { planetId: owner.planet.id, key: 'shipyard' } }, data: { level: 4 } });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'railBattery', quantity: 1 }).expect(409);
    await prisma.research.create({ data: { userId: owner.user.id, key: 'weaponTech', level: 2 } });
    const started = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'railBattery', quantity: 1 }).expect(201);
    const queueItem = await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: started.body.queueItem.id } });
    expect(queueItem).toMatchObject({ itemKey: 'railBattery', itemType: 'defence', canonicalDefenceKey: 'railBattery', quantity: 1, costAlloy: 6000, costHeliox: 2000, costAether: 0 });
    expect(started.body.queueItem).toMatchObject({ shipName: 'Rail Battery', cost: { alloy: 6000, heliox: 2000, aether: 0 }, cancellation: { refundPercentage: 50, refund: { alloy: 3000, heliox: 1000, aether: 0 } } });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 4000, heliox: 3000 });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${queueItem.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } })).toMatchObject({ alloy: 7000, heliox: 4000 });
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 10_000, heliox: 5_000, lastProductionAt: new Date() } });
    const accepted = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'railBattery', quantity: 1 }).expect(201);
    await prisma.shipyardQueueItem.update({ where: { id: accepted.body.queueItem.id }, data: { completesAt: new Date(Date.now() - 1) } });
    await Promise.all([completeShipyardBatch(prisma, accepted.body.queueItem.id), completeShipyardBatch(prisma, accepted.body.queueItem.id)]);
    expect(await prisma.defence.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.planet.id, key: 'railBattery' } } })).toMatchObject({ count: 1 });
    expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'SHIPYARD_COMPLETE' } })).toBe(1);
  });

  it('starts, cancels, and completes a canonical Planetary Shield only after its existing prerequisites', async () => {
    const owner = await player('shipyard-shield');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 40_000, heliox: 30_000, aether: 5_000, lastProductionAt: new Date() } });
    await prisma.building.createMany({ data: [
      { planetId: owner.planet.id, key: 'alloyStorage', level: 4 },
      { planetId: owner.planet.id, key: 'helioxStorage', level: 4 },
      { planetId: owner.planet.id, key: 'aetherStorage', level: 4 },
    ] });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'planetaryShield', quantity: 1 }).expect(409);
    await prisma.building.update({ where: { planetId_key: { planetId: owner.planet.id, key: 'shipyard' } }, data: { level: 6 } });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'planetaryShield', quantity: 1 }).expect(409);
    await prisma.research.create({ data: { userId: owner.user.id, key: 'shieldTech', level: 4 } });
    const started = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'planetaryShield', quantity: 1 }).expect(201);
    const queueItem = await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: started.body.queueItem.id } });
    expect(queueItem).toMatchObject({ itemKey: 'planetaryShield', itemType: 'defence', canonicalDefenceKey: 'planetaryShield', quantity: 1, costAlloy: 15_000, costHeliox: 8_000, costAether: 1_000 });
    expect(started.body.queueItem.cancellation).toEqual({ refundPercentage: 50, refund: { alloy: 7_500, heliox: 4_000, aether: 500 } });
    await request(app).delete(`/api/planets/${owner.planet.id}/shipyard/${queueItem.id}`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').expect(200);
    const accepted = await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ key: 'planetaryShield', quantity: 1 }).expect(201);
    await prisma.shipyardQueueItem.update({ where: { id: accepted.body.queueItem.id }, data: { completesAt: new Date(Date.now() - 1) } });
    await Promise.all([completeShipyardBatch(prisma, accepted.body.queueItem.id), completeShipyardBatch(prisma, accepted.body.queueItem.id)]);
    expect(await prisma.defence.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.planet.id, key: 'planetaryShield' } } })).toMatchObject({ count: 1 });
  });

  it('projects an allowlisted defence catalogue without promoting legacy rows', async () => {
    const owner = await player('shipyard-defence-read');
    await prisma.planet.update({ where: { id: owner.planet.id }, data: { alloy: 10_000, heliox: 5_000, aether: 1_000, lastProductionAt: new Date() } });
    await prisma.defence.create({ data: { planetId: owner.planet.id, key: 'flakTurret', count: 3 } });
    await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'railBattery', itemType: 'defence', quantity: 9, remaining: 9, costAlloy: 1, costHeliox: 1, costAether: 1, durationSeconds: 1, completesAt: new Date(Date.now() + 60_000) } });
    const response = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(response.body.defences).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'flakTurret', availability: 'ACTIVE', owned: 3, quantity: { min: 1, max: 100 } }),
      expect.objectContaining({ id: 'railBattery', availability: 'ACTIVE', meetsRequirements: false, availabilityReason: 'Available with Shipyard level 4 and Weapon Technology level 2.' }),
      expect.objectContaining({ id: 'planetaryShield', availability: 'ACTIVE', availabilityReason: 'Available with Shipyard level 6 and Shield Technology level 4.' }),
    ]));
    expect(response.body.defences.map((defence: { id: string }) => defence.id)).toEqual(['flakTurret', 'railBattery', 'planetaryShield']);
    expect(JSON.stringify(response.body.defences)).not.toContain('canonicalDefenceKey');
    expect(response.body.activeQueue).toBeNull();
    expect(response.body.legacyQueue).toEqual(expect.arrayContaining([expect.objectContaining({ itemKey: 'railBattery' })]));
  });

  it('contains legacy defence rows and includes a completed canonical Flak Turret in an immutable strike report', async () => {
    const defender = await player('shipyard-flak-defender');
    const attacker = await player('shipyard-flak-attacker');
    await prisma.planet.update({ where: { id: defender.planet.id }, data: { galaxy: 1, system: 1, slot: 1 } });
    await prisma.planet.update({ where: { id: attacker.planet.id }, data: { galaxy: 1, system: 1, slot: 2 } });
    defender.planet = await prisma.planet.findUniqueOrThrow({ where: { id: defender.planet.id } });
    attacker.planet = await prisma.planet.findUniqueOrThrow({ where: { id: attacker.planet.id } });
    await prisma.shipyardQueueItem.create({ data: { planetId: defender.planet.id, itemKey: 'railBattery', itemType: 'defence', quantity: 99, remaining: 99, costAlloy: 1, costHeliox: 1, costAether: 1, durationSeconds: 1, completesAt: new Date(Date.now() - 1) } });
    const legacy = await prisma.shipyardQueueItem.findFirstOrThrow({ where: { planetId: defender.planet.id } });
    expect(await completeShipyardBatch(prisma, legacy.id)).toBe('missing');
    expect(await prisma.defence.count({ where: { planetId: defender.planet.id } })).toBe(0);
    await prisma.shipyardQueueItem.update({ where: { id: legacy.id }, data: { status: 'CANCELLED' } });

    await prisma.planet.update({ where: { id: defender.planet.id }, data: { alloy: 20_000, heliox: 20_000, aether: 20_000, lastProductionAt: new Date() } });
    const flak = await request(app).post(`/api/planets/${defender.planet.id}/shipyard`).set('Cookie', defender.cookie).set('X-Eonrover-Client', '1').send({ key: 'flakTurret', quantity: 1 }).expect(201);
    await prisma.shipyardQueueItem.update({ where: { id: flak.body.queueItem.id }, data: { completesAt: new Date(Date.now() - 1) } });
    expect(await completeShipyardBatch(prisma, flak.body.queueItem.id)).toBe('completed');

    await prisma.ship.create({ data: { planetId: attacker.planet.id, key: 'corvette', count: 3 } });
    const now = new Date(); const plan = planCorvetteStrike({ origin: { galaxy: attacker.planet.galaxy, system: attacker.planet.system, slot: attacker.planet.slot }, target: { galaxy: defender.planet.galaxy, system: defender.planet.system, slot: defender.planet.slot }, quantity: 3, fleetSpeed: 1 });
    const arrivesAt = new Date(now.getTime() - 1);
    const mission = await prisma.fleetMission.create({ data: { originId: attacker.planet.id, targetId: defender.planet.id, targetGalaxy: defender.planet.galaxy, targetSystem: defender.planet.system, targetSlot: defender.planet.slot, missionType: 'ATTACK', ships: { legacy: 'ignored' }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100, departedAt: new Date(arrivesAt.getTime() - plan.outboundDurationSeconds * 1000), arrivesAt, returnsAt: new Date(now.getTime() + plan.returnDurationSeconds * 1000), status: 'OUTBOUND', corvetteStrikeOriginPlanetId: attacker.planet.id, corvetteStrikeTargetPlanetId: defender.planet.id, corvetteStrikeAttackerId: attacker.user.id, corvetteStrikeDefenderId: defender.user.id, corvetteStrikeShips: { corvette: 3 }, corvetteStrikeOutboundFuelHeliox: plan.outboundFuelHeliox, corvetteStrikeReturnFuelHeliox: plan.returnFuelHeliox, corvetteStrikeOutboundDurationSeconds: plan.outboundDurationSeconds, corvetteStrikeReturnDurationSeconds: plan.returnDurationSeconds, corvetteStrikeResolverVersion: 'corvette-strike-v1', corvetteStrikeResolverSeed: 'f'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: 'OUTBOUND' } });
    expect(await settleCanonicalCorvetteStrike(prisma, mission.id, now)).toBe('arrived');
    expect((await prisma.corvetteStrikeReport.findUniqueOrThrow({ where: { missionId: mission.id } }).then((report) => report.resultSnapshot as any)).starting.defender.flakTurret).toBe(1);
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';

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
    const pending = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'scout', itemType: 'ship', quantity: 2, remaining: 2, completesAt: new Date(Date.now() + 60000), jobId: 'private-job' } });
    const completed = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'probe', itemType: 'ship', quantity: 1, remaining: 0, status: 'COMPLETE', completesAt: new Date() } });
    const cancelled = await prisma.shipyardQueueItem.create({ data: { planetId: owner.planet.id, itemKey: 'recycler', itemType: 'ship', quantity: 1, remaining: 1, status: 'CANCELLED', completesAt: new Date() } });
    await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).expect(401);
    await request(app).get(`/api/planets/${other.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(404);
    const response = await request(app).get(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).expect(200);
    expect(Object.keys(response.body).sort()).toEqual(['catalog', 'categories', 'legacyQueue', 'selectedPlanet']);
    expect(response.body.categories.map((item: { id: string }) => item.id)).toEqual(['civilian', 'combat', 'specialist']);
    expect(response.body.catalog.map((item: { id: string }) => item.id)).toEqual(['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'probe', 'recycler']);
    expect(response.body.selectedPlanet).toMatchObject({ id: owner.planet.id, shipyardLevel: 2, resources: { alloy: 1234, heliox: 567, aether: 89 } });
    expect(response.body.catalog.find((item: { id: string }) => item.id === 'transporter')).toMatchObject({ owned: 3 });
    expect(response.body.legacyQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pending.id, status: 'PENDING' }),
      expect.objectContaining({ id: completed.id, status: 'COMPLETE' }),
      expect.objectContaining({ id: cancelled.id, status: 'CANCELLED' }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain('jobId');
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ remaining: 2, status: 'PENDING', jobId: 'private-job' });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: completed.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.shipyardQueueItem.findUniqueOrThrow({ where: { id: cancelled.id } })).toMatchObject({ status: 'CANCELLED' });
    await request(app).post(`/api/planets/${owner.planet.id}/shipyard`).set('Cookie', owner.cookie).set('X-Eonrover-Client', '1').send({ itemKey: 'scout', itemType: 'ship', quantity: 1 }).expect(404);
    expect(await prisma.shipyardQueueItem.count({ where: { planetId: owner.planet.id } })).toBe(3);
  });
});

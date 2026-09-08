import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';

const app = createApp();
async function player() {
  const user = await prisma.user.create({ data: { email: 'fleet-disabled@example.com', username: 'fleet-disabled', passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const planet = await prisma.planet.create({ data: { ownerId: user.id, name: 'Fleet Origin', galaxy: 6, system: 6, slot: 6, planetType: 'TEMPERATE', temperature: 1, solarIndex: 1, alloy: 100, heliox: 100, aether: 0 } });
  const token = `fleet-disabled-${user.id}`; await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, planet, cookie: `${SESSION_COOKIE}=${token}` };
}
describe('legacy fleet containment', () => {
  it('preserves authentication while every legacy route returns the unavailable boundary without state changes', async () => {
    await request(app).get('/api/fleet').expect(401);
    const { user, planet, cookie } = await player();
    await prisma.ship.create({ data: { planetId: planet.id, key: 'scout', count: 2 } });
    const mission = await prisma.fleetMission.create({ data: { originId: planet.id, targetGalaxy: 6, targetSystem: 6, targetSlot: 7, missionType: 'TRANSPORT', ships: { scout: 1 }, cargo: { alloy: 1 }, arrivesAt: new Date(Date.now() + 60_000) } });
    const before = await Promise.all([prisma.fleetMission.count(), prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: planet.id, key: 'scout' } } }), prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }), prisma.notification.count({ where: { userId: user.id } })]);
    for (const call of [request(app).get('/api/fleet').set('Cookie', cookie), request(app).post('/api/fleet').set('Cookie', cookie).set('X-Eonrover-Client', '1').send({ missionType: 'ATTACK', ships: { scout: 99 } }), request(app).post(`/api/fleet/${mission.id}/recall`).set('Cookie', cookie).set('X-Eonrover-Client', '1')]) {
      const response = await call.expect(503); expect(response.body).toEqual({ error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE' });
    }
    const after = await Promise.all([prisma.fleetMission.count(), prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: planet.id, key: 'scout' } } }), prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }), prisma.notification.count({ where: { userId: user.id } })]);
    expect(after).toEqual(before); expect(JSON.stringify((await request(app).get('/api/fleet').set('Cookie', cookie).expect(503)).body)).not.toContain(mission.id);
  });
});

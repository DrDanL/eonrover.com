import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
const app = createApp();

async function createLoggedInPlayer(email: string, username: string) {
  await request(app)
    .post('/api/auth/register')
    .set('X-Eonrover-Client', '1')
    .send({ email, username, password: 'Password123' })
    .expect(201);
  const token = await prisma.verificationToken.findFirstOrThrow({ where: { user: { email } } });
  await request(app).post('/api/auth/verify-email').set('X-Eonrover-Client', '1').send({ token: token.token });
  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Eonrover-Client', '1')
    .send({ email, password: 'Password123' })
    .expect(200);
  const cookie = login.headers['set-cookie'];
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const planet = await prisma.planet.findFirstOrThrow({ where: { ownerId: user.id } });
  return { cookie, user, planet };
}

describe('fleet missions', () => {
  it('rejects sending a fleet with no ships owned at the origin', async () => {
    const { cookie, planet } = await createLoggedInPlayer('empty@example.com', 'emptyfleet');

    await request(app)
      .post('/api/fleet')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({
        originId: planet.id,
        targetGalaxy: planet.galaxy,
        targetSystem: planet.system,
        targetSlot: planet.slot + 5,
        missionType: 'TRANSPORT',
        ships: { transporter: 1 },
      })
      .expect(409);
  });

  it('enqueues a TRANSPORT mission and deducts fuel/cargo from the origin', async () => {
    const { cookie, user, planet } = await createLoggedInPlayer('sender@example.com', 'sender1');
    await prisma.ship.create({ data: { planetId: planet.id, key: 'transporter', count: 5 } });

    const otherOwner = await prisma.user.create({
      data: { email: 'other@example.com', username: 'other1', passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    const target = await prisma.planet.create({
      data: {
        ownerId: otherOwner.id,
        name: 'Target Colony',
        galaxy: planet.galaxy,
        system: planet.system,
        slot: planet.slot + 1,
        planetType: 'TEMPERATE',
        temperature: 15,
        solarIndex: 1,
      },
    });

    const res = await request(app)
      .post('/api/fleet')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({
        originId: planet.id,
        targetGalaxy: target.galaxy,
        targetSystem: target.system,
        targetSlot: target.slot,
        missionType: 'TRANSPORT',
        ships: { transporter: 2 },
        cargo: { alloy: 50, heliox: 0, aether: 0 },
      })
      .expect(201);

    expect(res.body.mission.missionType).toBe('TRANSPORT');
    expect(res.body.mission.status).toBe('OUTBOUND');

    const originShips = await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: planet.id, key: 'transporter' } } });
    expect(originShips.count).toBe(3);
    void user;
  });

  it('rejects a GATE_TRAVEL mission when the origin has no linked Eon Gate', async () => {
    const { cookie, planet } = await createLoggedInPlayer('nolink@example.com', 'nolink1');
    await prisma.ship.create({ data: { planetId: planet.id, key: 'frigate', count: 1 } });
    const otherPlanet = await prisma.planet.create({
      data: {
        ownerId: (await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } })).ownerId,
        name: 'Far Colony',
        galaxy: planet.galaxy,
        system: planet.system,
        slot: planet.slot + 2,
        planetType: 'TEMPERATE',
        temperature: 15,
        solarIndex: 1,
      },
    });

    await request(app)
      .post('/api/fleet')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({
        originId: planet.id,
        targetGalaxy: otherPlanet.galaxy,
        targetSystem: otherPlanet.system,
        targetSlot: otherPlanet.slot,
        missionType: 'GATE_TRAVEL',
        ships: { frigate: 1 },
      })
      .expect(409);
  });

  it('allows a GATE_TRAVEL mission with a near-instant arrival once two gates are linked', async () => {
    const { cookie, user, planet } = await createLoggedInPlayer('gatetraveler@example.com', 'gatetraveler');
    await prisma.ship.create({ data: { planetId: planet.id, key: 'frigate', count: 1 } });
    const secondPlanet = await prisma.planet.create({
      data: {
        ownerId: user.id,
        name: 'Linked Colony',
        galaxy: planet.galaxy,
        system: planet.system,
        slot: planet.slot + 3,
        planetType: 'TEMPERATE',
        temperature: 15,
        solarIndex: 1,
      },
    });
    const originGate = await prisma.eonGate.create({ data: { planetId: planet.id, isVisible: true } });
    const targetGate = await prisma.eonGate.create({ data: { planetId: secondPlanet.id, isVisible: true, linkedGateId: originGate.id } });
    await prisma.eonGate.update({ where: { id: originGate.id }, data: { linkedGateId: targetGate.id } });

    const res = await request(app)
      .post('/api/fleet')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({
        originId: planet.id,
        targetGalaxy: secondPlanet.galaxy,
        targetSystem: secondPlanet.system,
        targetSlot: secondPlanet.slot,
        missionType: 'GATE_TRAVEL',
        ships: { frigate: 1 },
      })
      .expect(201);

    expect(res.body.mission.missionType).toBe('GATE_TRAVEL');
    const arrivesAt = new Date(res.body.mission.arrivesAt).getTime();
    const departedAt = new Date(res.body.mission.departedAt).getTime();
    expect(arrivesAt - departedAt).toBeLessThanOrEqual(20_000);
  });
});

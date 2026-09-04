import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { hasTestDatabase } from '../testSetup';

const describeIfDb = hasTestDatabase ? describe : describe.skip;
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

async function grantFragments(userId: string, planetId: string, count: number) {
  await prisma.gateFragment.createMany({
    data: Array.from({ length: count }, (_, i) => ({ ownerId: userId, planetId, fragmentKey: `fragment-${i}` })),
  });
}

describeIfDb('Eon Gates', () => {
  it('rejects activation without enough gate fragments', async () => {
    const { cookie, planet } = await createLoggedInPlayer('nogate@example.com', 'nogate');
    await prisma.building.create({ data: { planetId: planet.id, key: 'gateObservatory', level: 1 } });
    await prisma.research.create({ data: { userId: (await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } })).ownerId, key: 'gateTheory', level: 1 } });

    await request(app)
      .post('/api/gates/activate')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ planetId: planet.id })
      .expect(402);
  });

  it('rejects activation without the Gate Observatory / Gate Theory prerequisites', async () => {
    const { cookie, user, planet } = await createLoggedInPlayer('noprereq@example.com', 'noprereq');
    await grantFragments(user.id, planet.id, 3);

    await request(app)
      .post('/api/gates/activate')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ planetId: planet.id })
      .expect(409);
  });

  it('activates a gate and links two of the same player gates', async () => {
    const { cookie, user, planet } = await createLoggedInPlayer('gatekeeper@example.com', 'gatekeeper');
    await prisma.building.create({ data: { planetId: planet.id, key: 'gateObservatory', level: 1 } });
    await prisma.research.create({ data: { userId: user.id, key: 'gateTheory', level: 1 } });
    await grantFragments(user.id, planet.id, 3);

    const activate = await request(app)
      .post('/api/gates/activate')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ planetId: planet.id })
      .expect(201);
    expect(activate.body.gate.planetId).toBe(planet.id);

    const remainingFragments = await prisma.gateFragment.count({ where: { ownerId: user.id } });
    expect(remainingFragments).toBe(0);

    // Second planet + gate for the same player to link against.
    const secondPlanet = await prisma.planet.create({
      data: {
        ownerId: user.id,
        name: 'Second Colony',
        galaxy: planet.galaxy,
        system: planet.system,
        slot: planet.slot + 1,
        planetType: 'TEMPERATE',
        temperature: 15,
        solarIndex: 1,
      },
    });
    await prisma.building.create({ data: { planetId: secondPlanet.id, key: 'gateObservatory', level: 1 } });
    await grantFragments(user.id, secondPlanet.id, 3);
    await request(app)
      .post('/api/gates/activate')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ planetId: secondPlanet.id })
      .expect(201);

    await request(app)
      .post('/api/gates/link')
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ planetId: planet.id, targetPlanetId: secondPlanet.id })
      .expect(200);

    const originGate = await prisma.eonGate.findUniqueOrThrow({ where: { planetId: planet.id } });
    const targetGate = await prisma.eonGate.findUniqueOrThrow({ where: { planetId: secondPlanet.id } });
    expect(originGate.linkedGateId).toBe(targetGate.id);
    expect(targetGate.linkedGateId).toBe(originGate.id);
  });
});

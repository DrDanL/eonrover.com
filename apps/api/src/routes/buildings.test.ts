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
  return { cookie, planet };
}

describeIfDb('buildings queue', () => {
  it('enqueues an affordable building upgrade and deducts resources', async () => {
    const { cookie, planet } = await createLoggedInPlayer('builder@example.com', 'builder1');

    const res = await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyMine' })
      .expect(201);

    expect(res.body.queueItem.buildingKey).toBe('alloyMine');
    expect(res.body.queueItem.targetLevel).toBe(1);

    const updated = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    // Starting alloy 500, heliox 300; alloyMine level 1 costs 60 alloy / 15 heliox.
    expect(updated.alloy).toBe(440);
    expect(updated.heliox).toBe(285);
  });

  it('rejects a building whose prerequisites are not met', async () => {
    const { cookie, planet } = await createLoggedInPlayer('rookie@example.com', 'rookie1');

    await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'aetherSynthesizer' })
      .expect(409);
  });

  it('rejects an upgrade the planet cannot afford', async () => {
    const { cookie, planet } = await createLoggedInPlayer('poor@example.com', 'poor1');
    await prisma.planet.update({ where: { id: planet.id }, data: { alloy: 0, heliox: 0 } });

    await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyMine' })
      .expect(402);
  });

  it('refunds half the cost when a queued upgrade is cancelled', async () => {
    const { cookie, planet } = await createLoggedInPlayer('canceller@example.com', 'canceller1');
    const enqueue = await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyMine' })
      .expect(201);

    await request(app)
      .delete(`/api/planets/${planet.id}/buildings/${enqueue.body.queueItem.id}`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .expect(200);

    const updated = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    // 500 - 60 + 30 = 470, 300 - 15 + 7 (rounded) = 292
    expect(updated.alloy).toBe(470);
  });
});

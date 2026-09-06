import request from 'supertest';
import { createApp } from '../app';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { verificationTokenFromMail } from '../testUtils/verificationMail';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;

async function createLoggedInPlayer(email: string, username: string) {
  await request(app)
    .post('/api/auth/register')
    .set('X-Eonrover-Client', '1')
    .send({ email, username, password: 'Password123' })
    .expect(201);
  const token = verificationTokenFromMail(mockedSendMail.mock.calls, email);
  await request(app).post('/api/auth/verify-email').set('X-Eonrover-Client', '1').send({ token });
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

describe('buildings queue', () => {
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
    expect(res.body.queueItem).not.toHaveProperty('jobId');

    const updated = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    // Starting alloy 500, heliox 300; alloyMine level 1 costs 60 alloy / 15 heliox.
    expect(updated.alloy).toBe(440);
    expect(updated.heliox).toBe(285);
  });

  it('returns categorised presentation data without raw definitions or queue job identifiers', async () => {
    const { cookie, planet } = await createLoggedInPlayer('catalog@example.com', 'catalog1');
    const enqueue = await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyMine' })
      .expect(201);

    const response = await request(app)
      .get(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.categories.map((category: { key: string }) => category.key)).toEqual([
      'resources',
      'energy',
      'infrastructure',
    ]);
    expect(response.body.catalog).toHaveLength(10);
    expect(response.body.catalog.find((building: { key: string }) => building.key === 'solarArray')).toMatchObject({
      id: 'solarArray',
      category: 'energy',
      currentLevel: 1,
      nextLevel: 2,
      affordable: true,
      canConstruct: false,
      unavailableReasonCode: 'CONSTRUCTION_IN_PROGRESS',
      requirements: [],
      unmetRequirements: [],
      meetsPrerequisites: true,
    });
    expect(response.body.catalog.find((building: { key: string }) => building.key === 'alloyStorage')).toMatchObject({
      canConstruct: false,
      unavailableReasonCode: 'CONSTRUCTION_IN_PROGRESS',
      unavailableReason: 'Another building upgrade is already active.',
      meetsPrerequisites: false,
      requirements: [
        {
          buildingId: 'alloyMine',
          buildingName: 'Alloy Mine',
          requiredLevel: 2,
          currentLevel: 0,
          met: false,
        },
      ],
      unmetRequirements: [
        {
          buildingId: 'alloyMine',
          buildingName: 'Alloy Mine',
          requiredLevel: 2,
          currentLevel: 0,
          met: false,
        },
      ],
    });
    expect(response.body.catalog[0]).not.toHaveProperty('baseCost');
    expect(response.body.catalog[0]).not.toHaveProperty('costGrowth');
    expect(response.body.planet).toEqual({
      alloy: expect.any(Number),
      heliox: expect.any(Number),
      aether: expect.any(Number),
      lastProductionAt: expect.any(String),
    });
    expect(response.body.planet).not.toHaveProperty('ownerId');
    expect(response.body.queue).toHaveLength(1);
    expect(response.body.queue[0]).toMatchObject({ id: enqueue.body.queueItem.id, buildingName: 'Alloy Mine' });
    expect(response.body.queue[0]).not.toHaveProperty('jobId');
  });

  it('presents and rejects a building whose prerequisites are not met', async () => {
    const { cookie, planet } = await createLoggedInPlayer('rookie@example.com', 'rookie1');

    const catalog = await request(app)
      .get(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .expect(200);
    expect(catalog.body.catalog.find((building: { key: string }) => building.key === 'gateObservatory')).toMatchObject({
      meetsPrerequisites: false,
      canConstruct: false,
      unavailableReasonCode: 'PREREQUISITES_NOT_MET',
      unavailableReason: 'Requires Research Lab level 3, Aether Synthesizer level 2, Solar Array level 4.',
      requirements: [
        { buildingId: 'researchLab', buildingName: 'Research Lab', requiredLevel: 3, currentLevel: 0, met: false },
        { buildingId: 'aetherSynthesizer', buildingName: 'Aether Synthesizer', requiredLevel: 2, currentLevel: 0, met: false },
        { buildingId: 'solarArray', buildingName: 'Solar Array', requiredLevel: 4, currentLevel: 1, met: false },
      ],
    });

    const response = await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyStorage' })
      .expect(409);

    expect(response.body.code).toBe('PREREQUISITES_NOT_MET');
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

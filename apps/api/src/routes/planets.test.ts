import request from 'supertest';
import { STARTING_RESOURCES } from '@eonrover/shared';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { invalidateUniverseConfigCache } from '../services/gameConfig';

const app = createApp();
const NOW = new Date('2026-06-01T12:00:00.000Z');
let coordinate = 1;

interface TestPlanetOptions {
  email?: string;
  username?: string;
  alloy?: number;
  heliox?: number;
  aether?: number;
  lastProductionAt?: Date;
  alloyMineLevel?: number;
  helioxExtractorLevel?: number;
  aetherSynthesizerLevel?: number;
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  coordinate = 1;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  jest.useRealTimers();
  invalidateUniverseConfigCache();
});

async function createPlayerPlanet(options: TestPlanetOptions = {}) {
  const email = options.email ?? 'planet-owner@example.com';
  const username = options.username ?? 'planet-owner';
  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: NOW,
    },
  });
  const planet = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `${username}'s planet`,
      galaxy: 1,
      system: 1,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: options.alloy ?? 500,
      heliox: options.heliox ?? 300,
      aether: options.aether ?? 0,
      lastProductionAt: options.lastProductionAt ?? new Date(NOW.getTime() - 60 * 60 * 1000),
      buildings: {
        create: [
          { key: 'alloyMine', level: options.alloyMineLevel ?? 1 },
          { key: 'helioxExtractor', level: options.helioxExtractorLevel ?? 1 },
          { key: 'aetherSynthesizer', level: options.aetherSynthesizerLevel ?? 0 },
          { key: 'solarArray', level: 1 },
        ],
      },
    },
  });
  const rawSessionToken = `planet-session-${user.id}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawSessionToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    },
  });

  return {
    user,
    planet,
    cookie: `${SESSION_COOKIE}=${rawSessionToken}`,
  };
}

describe('authoritative planet resource synchronisation', () => {
  it('persists accrued resources when the dashboard planet list is accessed', async () => {
    const { cookie, planet } = await createPlayerPlanet();

    const response = await request(app).get('/api/planets').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.planets).toHaveLength(1);
    expect(response.body.planets[0]).toMatchObject({
      id: planet.id,
      alloy: 533,
      heliox: 322,
      aether: 0,
      lastProductionAt: NOW.toISOString(),
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(533);
    expect(persisted.heliox).toBe(322);
    expect(persisted.aether).toBe(0);
    expect(persisted.lastProductionAt).toEqual(NOW);
  });

  it('does not credit the same elapsed interval on a later read', async () => {
    const { cookie, planet } = await createPlayerPlanet();

    const first = await request(app).get(`/api/planets/${planet.id}`).set('Cookie', cookie);
    const second = await request(app).get(`/api/planets/${planet.id}`).set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.planet.alloy).toBe(first.body.planet.alloy);
    expect(second.body.planet.heliox).toBe(first.body.planet.heliox);
    expect(second.body.planet.lastProductionAt).toBe(first.body.planet.lastProductionAt);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(first.body.planet.alloy);
    expect(persisted.heliox).toBe(first.body.planet.heliox);
  });

  it('serialises concurrent reads so the elapsed interval is credited once', async () => {
    const { cookie, planet } = await createPlayerPlanet({ alloy: 100, heliox: 100 });

    const [first, second] = await Promise.all([
      request(app).get('/api/planets').set('Cookie', cookie),
      request(app).get('/api/planets').set('Cookie', cookie),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.planets[0].alloy).toBe(133);
    expect(second.body.planets[0].alloy).toBe(133);
    expect(first.body.planets[0].heliox).toBe(122);
    expect(second.body.planets[0].heliox).toBe(122);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(133);
    expect(persisted.heliox).toBe(122);
    expect(persisted.lastProductionAt).toEqual(NOW);
  });

  it('does not let another user inspect or synchronise the planet', async () => {
    const owner = await createPlayerPlanet();
    const other = await createPlayerPlanet({
      email: 'other-player@example.com',
      username: 'other-player',
      lastProductionAt: NOW,
    });

    const response = await request(app).get(`/api/planets/${owner.planet.id}`).set('Cookie', other.cookie);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Planet not found', code: 'NOT_FOUND' });
    const unchanged = await prisma.planet.findUniqueOrThrow({ where: { id: owner.planet.id } });
    expect(unchanged.alloy).toBe(500);
    expect(unchanged.heliox).toBe(300);
    expect(unchanged.lastProductionAt).toEqual(new Date(NOW.getTime() - 60 * 60 * 1000));
  });

  it('ignores client-supplied balances and production timestamps', async () => {
    const { cookie, planet } = await createPlayerPlanet({ alloy: 100, heliox: 100 });

    const response = await request(app)
      .get(`/api/planets/${planet.id}`)
      .query({ alloy: 999_999, heliox: 999_999, lastProductionAt: '2000-01-01T00:00:00.000Z' })
      .send({ alloy: 999_999, aether: 999_999, lastProductionAt: '2000-01-01T00:00:00.000Z' })
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.planet.alloy).toBe(133);
    expect(response.body.planet.heliox).toBe(122);
    expect(response.body.planet.aether).toBe(0);
    expect(response.body.planet.lastProductionAt).toBe(NOW.toISOString());
  });

  it('keeps Stage 2 starter resources compatible when production buildings are level zero', async () => {
    const { cookie, planet } = await createPlayerPlanet({
      alloy: STARTING_RESOURCES.alloy,
      heliox: STARTING_RESOURCES.heliox,
      aether: STARTING_RESOURCES.aether,
      alloyMineLevel: 0,
      helioxExtractorLevel: 0,
      aetherSynthesizerLevel: 0,
    });

    const response = await request(app).get(`/api/planets/${planet.id}`).set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.planet).toMatchObject(STARTING_RESOURCES);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect({ alloy: persisted.alloy, heliox: persisted.heliox, aether: persisted.aether }).toEqual(
      STARTING_RESOURCES,
    );
    expect(persisted.lastProductionAt).toEqual(NOW);
  });
});

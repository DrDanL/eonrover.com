import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { buildQueue } from '../lib/redis';
import { completeBuildingConstruction } from '../services/buildingCompletionService';
import { invalidateUniverseConfigCache } from '../services/gameConfig';

const app = createApp();
const NOW = new Date('2026-09-05T16:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
let coordinate = 1;
const addJob = jest.spyOn(buildQueue, 'add');
const getJob = jest.spyOn(buildQueue, 'getJob');

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  coordinate = 1;
  invalidateUniverseConfigCache();
  addJob.mockReset().mockResolvedValue({ id: 'test-job' } as never);
  getJob.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  invalidateUniverseConfigCache();
});

afterAll(() => {
  addJob.mockRestore();
  getJob.mockRestore();
});

async function createPlayerPlanet(options: {
  alloy?: number;
  heliox?: number;
  lastProductionAt?: Date;
  alloyMineLevel?: number;
} = {}) {
  const user = await prisma.user.create({
    data: {
      email: `api-completion-${coordinate}@example.com`,
      username: `api-completion-${coordinate}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: NOW,
    },
  });
  const planet = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `API Completion ${coordinate}`,
      galaxy: 6,
      system: 1,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: options.alloy ?? 100,
      heliox: options.heliox ?? 100,
      aether: 0,
      lastProductionAt: options.lastProductionAt ?? NOW,
      buildings: {
        create: [
          { key: 'alloyMine', level: options.alloyMineLevel ?? 0 },
          { key: 'solarArray', level: 0 },
        ],
      },
    },
  });
  const rawSessionToken = `api-completion-session-${user.id}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawSessionToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    },
  });
  return { user, planet, cookie: `${SESSION_COOKIE}=${rawSessionToken}` };
}

async function createConstruction(planetId: string, completesAt: Date) {
  return prisma.buildQueueItem.create({
    data: {
      planetId,
      buildingKey: 'alloyMine',
      targetLevel: 1,
      costAlloy: 60,
      costHeliox: 15,
      costAether: 0,
      startedAt: new Date(completesAt.getTime() - HOUR_MS),
      completesAt,
    },
  });
}

function cancel(cookie: string, planetId: string, constructionId: string) {
  return request(app)
    .delete(`/api/planets/${planetId}/buildings/${constructionId}`)
    .set('Cookie', cookie)
    .set('X-Eonrover-Client', '1');
}

describe('building completion API fallback', () => {
  it('completes an overdue construction before returning authoritative planet resources', async () => {
    const finish = new Date(NOW.getTime() - HOUR_MS);
    const { planet, cookie } = await createPlayerPlanet({
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
    });
    const construction = await createConstruction(planet.id, finish);

    const response = await request(app).get(`/api/planets/${planet.id}`).set('Cookie', cookie).expect(200);

    expect(response.body.planet.alloy).toBeCloseTo(133, 10);
    expect(response.body.planet.lastProductionAt).toBe(NOW.toISOString());
    expect(response.body.buildings).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'alloyMine', level: 1 })]),
    );
    expect(response.body.buildQueue).toHaveLength(0);
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: construction.id } })).status).toBe('COMPLETE');
  });

  it('refreshes the building page state with the completed level, balances, and no active construction', async () => {
    const finish = new Date(NOW.getTime() - HOUR_MS);
    const { planet, cookie } = await createPlayerPlanet({
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
    });
    await createConstruction(planet.id, finish);

    const response = await request(app)
      .get(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.queue).toHaveLength(0);
    expect(response.body.planet.alloy).toBeCloseTo(133, 10);
    expect(response.body.production.alloy).toBeCloseTo(33, 10);
    expect(response.body.catalog).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'alloyMine', level: 1 })]),
    );
  });

  it('does not complete a future construction during API access', async () => {
    const completesAt = new Date(NOW.getTime() + HOUR_MS);
    const { planet, cookie } = await createPlayerPlanet({
      lastProductionAt: new Date(NOW.getTime() - HOUR_MS),
    });
    const construction = await createConstruction(planet.id, completesAt);

    const response = await request(app).get(`/api/planets/${planet.id}`).set('Cookie', cookie).expect(200);

    expect(response.body.buildQueue).toHaveLength(1);
    expect(response.body.buildings).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'alloyMine', level: 0 })]),
    );
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: construction.id } })).status).toBe('PENDING');
    expect(await prisma.notification.count({ where: { type: 'BUILDING_COMPLETE' } })).toBe(0);
  });

  it('completes due construction before accepting the next valid upgrade', async () => {
    const { planet, cookie } = await createPlayerPlanet({ alloy: 1_000, heliox: 1_000 });
    const completed = await createConstruction(planet.id, NOW);

    const response = await request(app)
      .post(`/api/planets/${planet.id}/buildings`)
      .set('Cookie', cookie)
      .set('X-Eonrover-Client', '1')
      .send({ key: 'alloyMine' })
      .expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyMine', targetLevel: 2 });
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe('COMPLETE');
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id, status: 'PENDING' } })).toBe(1);
    expect((await prisma.building.findUniqueOrThrow({
      where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
    })).level).toBe(1);
  });
});

describe('building completion and cancellation winner', () => {
  it('allows exactly one terminal outcome during a concurrent cancellation/completion race', async () => {
    const completesAt = new Date(NOW.getTime() + HOUR_MS);
    const { planet, cookie } = await createPlayerPlanet({ alloy: 440, heliox: 285 });
    const construction = await createConstruction(planet.id, completesAt);

    const [cancellation] = await Promise.all([
      cancel(cookie, planet.id, construction.id),
      completeBuildingConstruction(construction.id, new Date(completesAt.getTime() + HOUR_MS)),
    ]);

    const persistedConstruction = await prisma.buildQueueItem.findUniqueOrThrow({
      where: { id: construction.id },
    });
    const persistedPlanet = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    const building = await prisma.building.findUniqueOrThrow({
      where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
    });
    const notifications = await prisma.notification.count({ where: { type: 'BUILDING_COMPLETE' } });

    if (persistedConstruction.status === 'CANCELLED') {
      expect(cancellation.status).toBe(200);
      expect({ alloy: persistedPlanet.alloy, heliox: persistedPlanet.heliox }).toEqual({ alloy: 470, heliox: 293 });
      expect(building.level).toBe(0);
      expect(notifications).toBe(0);
    } else {
      expect(persistedConstruction.status).toBe('COMPLETE');
      expect(cancellation.status).toBe(409);
      expect(persistedPlanet.alloy).toBeCloseTo(473, 10);
      expect(persistedPlanet.heliox).toBe(285);
      expect(building.level).toBe(1);
      expect(notifications).toBe(1);
    }
  });

  it('keeps completion as a no-op after cancellation wins', async () => {
    const completesAt = new Date(NOW.getTime() + HOUR_MS);
    const { planet, cookie } = await createPlayerPlanet({ alloy: 440, heliox: 285 });
    const construction = await createConstruction(planet.id, completesAt);

    await cancel(cookie, planet.id, construction.id).expect(200);
    const result = await completeBuildingConstruction(
      construction.id,
      new Date(completesAt.getTime() + HOUR_MS),
    );

    expect(result.outcome).toBe('cancelled');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(470);
    expect(persisted.heliox).toBe(293);
    expect((await prisma.building.findUniqueOrThrow({
      where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
    })).level).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'BUILDING_COMPLETE' } })).toBe(0);
  });

  it('returns the terminal conflict without refund after completion wins', async () => {
    const { planet, cookie } = await createPlayerPlanet({ alloy: 440, heliox: 285 });
    const construction = await createConstruction(planet.id, NOW);
    await completeBuildingConstruction(construction.id, NOW);

    const response = await cancel(cookie, planet.id, construction.id).expect(409);

    expect(response.body.code).toBe('CONSTRUCTION_NOT_CANCELLABLE');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(440);
    expect(persisted.heliox).toBe(285);
    expect(await prisma.notification.count({ where: { type: 'BUILDING_COMPLETE' } })).toBe(1);
  });
});

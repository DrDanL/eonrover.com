import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { invalidateUniverseConfigCache } from '../services/gameConfig';

const app = createApp();
const NOW = new Date('2026-07-01T12:00:00.000Z');
let slot = 1;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  slot = 1;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  jest.useRealTimers();
  invalidateUniverseConfigCache();
});

async function createPlayer(email: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const user = await prisma.user.create({
    data: {
      email,
      username: email.split('@')[0],
      passwordHash: 'not-used',
      status,
      emailVerifiedAt: NOW,
    },
  });
  const rawToken = `command-summary-${user.id}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${rawToken}` };
}

async function createPlanet(ownerId: string, options: { name?: string; lastProductionAt?: Date } = {}) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: options.name ?? 'Command Prime',
      isHomeworld: slot === 1,
      galaxy: 1,
      system: 7,
      slot: slot++,
      planetType: 'TEMPERATE',
      temperature: 14,
      solarIndex: 0.7,
      alloy: 500,
      heliox: 300,
      aether: 0,
      lastProductionAt: options.lastProductionAt ?? new Date(NOW.getTime() - 3_600_000),
      buildings: {
        create: [
          { key: 'alloyMine', level: 1 },
          { key: 'helioxExtractor', level: 1 },
          { key: 'aetherSynthesizer', level: 0 },
          { key: 'solarArray', level: 1 },
        ],
      },
    },
  });
}

function getSummary(cookie: string, planetId?: string) {
  const requestBuilder = request(app).get('/api/planets/command-summary').set('Cookie', cookie);
  return planetId ? requestBuilder.query({ planetId }) : requestBuilder;
}

describe('authenticated command summary', () => {
  it('returns an explicitly allowlisted account-wide active research item for either owned planet', async () => {
    const { user, cookie } = await createPlayer('summary-research@example.com');
    const first = await createPlanet(user.id);
    const second = await createPlanet(user.id);
    const queue = await prisma.researchQueueItem.create({ data: { userId: user.id, planetId: first.id, researchKey: 'weaponTech', targetLevel: 2, costAlloy: 300, costHeliox: 300, costAether: 40, durationSeconds: 60, startedAt: NOW, completesAt: new Date(NOW.getTime() + 60_000) } });
    const [fromFirst, fromSecond] = await Promise.all([getSummary(cookie, first.id), getSummary(cookie, second.id)]);
    for (const response of [fromFirst, fromSecond]) {
      expect(response.status).toBe(200);
      expect(response.body.activeResearch).toEqual(expect.objectContaining({ queueItemId: queue.id, id: 'weaponTech', targetLevel: 2, originatingPlanet: expect.objectContaining({ id: first.id, name: first.name }) }));
      expect(JSON.stringify(response.body.activeResearch)).not.toContain('jobId');
      expect(JSON.stringify(response.body.activeResearch)).not.toContain('costAlloy');
    }
  });

  it('settles overdue research once before returning the command summary', async () => {
    const { user, cookie } = await createPlayer('summary-research-overdue@example.com');
    const planet = await createPlanet(user.id);
    await prisma.researchQueueItem.create({ data: { userId: user.id, planetId: planet.id, researchKey: 'weaponTech', targetLevel: 1, costAlloy: 1, costHeliox: 1, costAether: 1, durationSeconds: 1, startedAt: new Date(NOW.getTime() - 2_000), completesAt: new Date(NOW.getTime() - 1_000) } });
    await getSummary(cookie, planet.id).expect(200);
    await getSummary(cookie, planet.id).expect(200);
    expect(await prisma.research.findUniqueOrThrow({ where: { userId_key: { userId: user.id, key: 'weaponTech' } } })).toMatchObject({ level: 1 });
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'RESEARCH_COMPLETE' } })).toBe(1);
  });

  it('returns one timestamped, authoritative resource and production snapshot', async () => {
    const { user, cookie } = await createPlayer('summary-owner@example.com');
    const planet = await createPlanet(user.id);

    const response = await getSummary(cookie, planet.id)
      .query({ alloy: 999_999, energy: 999_999, serverTimestamp: '2000-01-01T00:00:00.000Z' })
      .expect(200);

    expect(response.body.serverTimestamp).toBe(NOW.toISOString());
    expect(response.body.selectedPlanetId).toBe(planet.id);
    expect(response.body.selectedPlanet.resources).toEqual({ alloy: 533, heliox: 322, aether: 0 });
    expect(response.body.selectedPlanet.productionPerHour).toEqual({ alloy: 33, heliox: 22, aether: 0 });
    expect(response.body.selectedPlanet.energy).toMatchObject({ supply: 46.4, demand: 22, available: 24.4 });
    expect(response.body.selectedPlanet.fields).toEqual({
      capacity: 180,
      completedUsed: 3,
      reserved: 0,
      occupied: 3,
      available: 177,
      isAtCapacity: false,
      isOverCapacity: false,
      overCapacityBy: 0,
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.lastProductionAt).toEqual(NOW);
  });

  it('settles overdue building construction before producing the snapshot', async () => {
    const { user, cookie } = await createPlayer('summary-overdue@example.com');
    const planet = await createPlanet(user.id);
    const construction = await prisma.buildQueueItem.create({
      data: {
        planetId: planet.id,
        buildingKey: 'alloyMine',
        targetLevel: 2,
        costAlloy: 90,
        costHeliox: 23,
        costAether: 0,
        startedAt: new Date(NOW.getTime() - 7_200_000),
        completesAt: new Date(NOW.getTime() - 1_800_000),
      },
    });

    const response = await getSummary(cookie, planet.id).expect(200);

    expect(response.body.selectedPlanet.activeConstruction).toBeNull();
    expect(response.body.selectedPlanet.buildings).toEqual(
      expect.arrayContaining([{ key: 'alloyMine', name: 'Alloy Mine', level: 2 }]),
    );
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: construction.id } })).status).toBe('COMPLETE');
  });

  it('rejects access to another player planet without synchronising it', async () => {
    const owner = await createPlayer('summary-private@example.com');
    const planet = await createPlanet(owner.user.id);
    const outsider = await createPlayer('summary-outsider@example.com');

    await getSummary(outsider.cookie, planet.id).expect(404, {
      error: 'Planet not found',
      code: 'NOT_FOUND',
    });
    const unchanged = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(unchanged.alloy).toBe(500);
    expect(unchanged.lastProductionAt).toEqual(new Date(NOW.getTime() - 3_600_000));
  });

  it('rejects a suspended account before returning game state', async () => {
    const suspended = await createPlayer('summary-suspended@example.com', 'SUSPENDED');
    await createPlanet(suspended.user.id);

    const response = await getSummary(suspended.cookie).expect(403);
    expect(response.body.code).toBe('ACCOUNT_UNAVAILABLE');
  });

  it('returns an explicit allowlist without internal records or job identifiers', async () => {
    const { user, cookie } = await createPlayer('summary-allowlist@example.com');
    const planet = await createPlanet(user.id);
    await prisma.buildQueueItem.create({
      data: {
        planetId: planet.id,
        buildingKey: 'solarArray',
        targetLevel: 2,
        costAlloy: 113,
        costHeliox: 45,
        costAether: 0,
        startedAt: NOW,
        completesAt: new Date(NOW.getTime() + 60_000),
        jobId: 'internal-job-id',
      },
    });

    const response = await getSummary(cookie, planet.id).expect(200);

    expect(Object.keys(response.body).sort()).toEqual([
      'activeResearch',
      'ownedPlanets',
      'selectedPlanet',
      'selectedPlanetId',
      'serverTimestamp',
    ]);
    expect(response.body.activeResearch).toBeNull();
    expect(Object.keys(response.body.selectedPlanet).sort()).toEqual([
      'activeConstruction',
      'buildings',
      'energy',
      'energyBlockedBuildingKeys',
      'fields',
      'identity',
      'productionPerHour',
      'resources',
      'storage',
    ]);
    expect(Object.keys(response.body.selectedPlanet.identity).sort()).toEqual([
      'coordinates',
      'id',
      'isHomeworld',
      'name',
      'planetType',
      'solarIndex',
      'temperature',
    ]);
    expect(response.body.selectedPlanet.identity).not.toHaveProperty('ownerId');
    expect(response.body.selectedPlanet.activeConstruction).not.toHaveProperty('jobId');
    expect(Object.keys(response.body.selectedPlanet.fields).sort()).toEqual([
      'available',
      'capacity',
      'completedUsed',
      'isAtCapacity',
      'isOverCapacity',
      'occupied',
      'overCapacityBy',
      'reserved',
    ]);
    expect(response.body.selectedPlanet.fields).toMatchObject({ completedUsed: 3, reserved: 1, occupied: 4 });
    expect(response.body.ownedPlanets[0]).not.toHaveProperty('ownerId');
  });

  it('returns every owned planet for selection and honours the selected planet', async () => {
    const { user, cookie } = await createPlayer('summary-multiple@example.com');
    const homeworld = await createPlanet(user.id, { name: 'First Light' });
    const colony = await createPlanet(user.id, { name: 'Far Reach' });

    const response = await getSummary(cookie, colony.id).expect(200);

    expect(response.body.selectedPlanetId).toBe(colony.id);
    expect(response.body.selectedPlanet.identity.name).toBe('Far Reach');
    expect(response.body.ownedPlanets).toEqual([
      expect.objectContaining({ id: homeworld.id, name: 'First Light' }),
      expect.objectContaining({ id: colony.id, name: 'Far Reach' }),
    ]);
  });

  it('returns a stable empty state when the account owns no planets', async () => {
    const { cookie } = await createPlayer('summary-empty@example.com');
    const response = await getSummary(cookie).expect(200);

    expect(response.body).toEqual({
      serverTimestamp: NOW.toISOString(),
      selectedPlanetId: null,
      selectedPlanet: null,
      ownedPlanets: [],
    });
  });

  it('does not duplicate production across immediate reads', async () => {
    const { user, cookie } = await createPlayer('summary-repeat@example.com');
    const planet = await createPlanet(user.id);

    const first = await getSummary(cookie, planet.id).expect(200);
    const second = await getSummary(cookie, planet.id).expect(200);

    expect(second.body.selectedPlanet.resources).toEqual(first.body.selectedPlanet.resources);
    expect(second.body.serverTimestamp).toBe(first.body.serverTimestamp);
  });
});

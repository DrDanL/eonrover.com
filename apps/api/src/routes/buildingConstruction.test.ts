import request from 'supertest';
import { BuildingKey, buildCompletionJobId, buildingCost, buildingDurationSeconds } from '@eonrover/shared';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { buildQueue } from '../lib/redis';
import { invalidateUniverseConfigCache } from '../services/gameConfig';
import { scheduleBuildCompletion } from './buildings';

const app = createApp();
const NOW = new Date('2026-09-04T12:00:00.000Z');
let coordinate = 1;

const addJob = jest.spyOn(buildQueue, 'add');
const getJob = jest.spyOn(buildQueue, 'getJob');
const removeJob = jest.fn();

interface PlanetOptions {
  ownerId: string;
  name?: string;
  alloy?: number;
  heliox?: number;
  aether?: number;
  lastProductionAt?: Date;
  alloyMineLevel?: number;
  helioxExtractorLevel?: number;
  aetherSynthesizerLevel?: number;
  solarArrayLevel?: number;
  researchLabLevel?: number;
  solarIndex?: number;
  fieldCapacity?: number;
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  coordinate = 1;
  invalidateUniverseConfigCache();
  removeJob.mockReset().mockResolvedValue(undefined);
  addJob.mockReset().mockResolvedValue({ id: 'mock-job' } as never);
  getJob.mockReset().mockResolvedValue({ remove: removeJob } as never);
});

afterEach(() => {
  jest.useRealTimers();
  invalidateUniverseConfigCache();
});

afterAll(() => {
  addJob.mockRestore();
  getJob.mockRestore();
});

async function createPlayer(email: string, username: string) {
  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: NOW,
    },
  });
  const rawSessionToken = `construction-session-${user.id}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawSessionToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${rawSessionToken}` };
}

async function createPlanet(options: PlanetOptions) {
  return prisma.planet.create({
    data: {
      ownerId: options.ownerId,
      name: options.name ?? `Construction test ${coordinate}`,
      galaxy: 1,
      system: 1,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: options.solarIndex ?? 0.7,
      fieldCapacity: options.fieldCapacity ?? 180,
      alloy: options.alloy ?? 1_000,
      heliox: options.heliox ?? 1_000,
      aether: options.aether ?? 1_000,
      lastProductionAt: options.lastProductionAt ?? NOW,
      buildings: {
        create: [
          { key: 'alloyMine', level: options.alloyMineLevel ?? 0 },
          { key: 'helioxExtractor', level: options.helioxExtractorLevel ?? 0 },
          { key: 'aetherSynthesizer', level: options.aetherSynthesizerLevel ?? 0 },
          { key: 'solarArray', level: options.solarArrayLevel ?? 0 },
          { key: 'researchLab', level: options.researchLabLevel ?? 0 },
        ],
      },
    },
  });
}

function startConstruction(cookie: string, planetId: string, body: Record<string, unknown> = { key: 'alloyMine' }) {
  return request(app)
    .post(`/api/planets/${planetId}/buildings`)
    .set('Cookie', cookie)
    .set('X-Eonrover-Client', '1')
    .send(body);
}

function cancelConstruction(cookie: string, planetId: string, queueItemId: string) {
  return request(app)
    .delete(`/api/planets/${planetId}/buildings/${queueItemId}`)
    .set('Cookie', cookie)
    .set('X-Eonrover-Client', '1');
}

async function createPendingConstruction(
  planetId: string,
  overrides: Partial<{
    buildingKey: BuildingKey;
    targetLevel: number;
    costAlloy: number;
    costHeliox: number;
    costAether: number;
    status: 'PENDING' | 'COMPLETE' | 'CANCELLED';
    jobId: string | null;
    startedAt: Date;
    completesAt: Date;
  }> = {},
) {
  return prisma.buildQueueItem.create({
    data: {
      planetId,
      buildingKey: overrides.buildingKey ?? 'alloyMine',
      targetLevel: overrides.targetLevel ?? 1,
      costAlloy: overrides.costAlloy ?? 60,
      costHeliox: overrides.costHeliox ?? 15,
      costAether: overrides.costAether ?? 0,
      startedAt: overrides.startedAt ?? NOW,
      completesAt: overrides.completesAt ?? new Date(NOW.getTime() + 60_000),
      status: overrides.status ?? 'PENDING',
      jobId: overrides.jobId === undefined ? 'building-test-job' : overrides.jobId,
    },
  });
}

describe('atomic building construction start', () => {
  it('synchronises production and atomically deducts an affordable upgrade', async () => {
    const { user, cookie } = await createPlayer('atomic-builder@example.com', 'atomic-builder');
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 500,
      heliox: 300,
      aether: 0,
      alloyMineLevel: 1,
      helioxExtractorLevel: 1,
      solarArrayLevel: 1,
      lastProductionAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem).toMatchObject({
      buildingKey: 'alloyMine',
      targetLevel: 2,
      costAlloy: 90,
      costHeliox: 23,
      costAether: 0,
    });
    expect(response.body.queueItem).not.toHaveProperty('planetId');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(443);
    expect(persisted.heliox).toBe(299);
    expect(persisted.aether).toBe(0);
    expect(persisted.lastProductionAt).toEqual(NOW);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(1);
  });

  it('targets exactly the completed level plus one and ignores old terminal queue targets', async () => {
    const { user, cookie } = await createPlayer('level-builder@example.com', 'level-builder');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 3, solarArrayLevel: 1 });
    await prisma.buildQueueItem.create({
      data: {
        planetId: planet.id,
        buildingKey: 'helioxExtractor',
        targetLevel: 99,
        costAlloy: 1,
        costHeliox: 1,
        costAether: 1,
        startedAt: new Date(NOW.getTime() - 120_000),
        completesAt: new Date(NOW.getTime() - 60_000),
        status: 'CANCELLED',
      },
    });

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem.targetLevel).toBe(4);
  });

  it('persists the server-calculated cost, start time, and duration', async () => {
    const { user, cookie } = await createPlayer('formula-builder@example.com', 'formula-builder');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1, researchLabLevel: 1 });
    const expectedCost = buildingCost('alloyMine', 2);
    const expectedSeconds = buildingDurationSeconds(expectedCost, 1, 1);

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem).toMatchObject({
      costAlloy: expectedCost.alloy,
      costHeliox: expectedCost.heliox,
      costAether: expectedCost.aether,
      startedAt: NOW.toISOString(),
      completesAt: new Date(NOW.getTime() + expectedSeconds * 1000).toISOString(),
    });
  });

  it('ignores client-supplied costs, levels, balances, durations, and timestamps', async () => {
    const { user, cookie } = await createPlayer('untrusted-builder@example.com', 'untrusted-builder');
    const planet = await createPlanet({ ownerId: user.id, alloy: 500, heliox: 300, aether: 0 });

    const response = await startConstruction(cookie, planet.id, {
      key: 'alloyMine',
      targetLevel: 99,
      cost: { alloy: 0, heliox: 0, aether: 0 },
      alloy: 999_999,
      heliox: 999_999,
      aether: 999_999,
      durationSeconds: 1,
      startedAt: '2000-01-01T00:00:00.000Z',
      completesAt: '2000-01-01T00:00:01.000Z',
    }).expect(201);

    expect(response.body.queueItem).toMatchObject({
      targetLevel: 1,
      costAlloy: 60,
      costHeliox: 15,
      costAether: 0,
      startedAt: NOW.toISOString(),
      completesAt: new Date(NOW.getTime() + 108_000).toISOString(),
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect({ alloy: persisted.alloy, heliox: persisted.heliox, aether: persisted.aether }).toEqual({
      alloy: 440,
      heliox: 285,
      aether: 0,
    });
  });

  it('allows a dependent building when its completed prerequisite level is sufficient', async () => {
    const { user, cookie } = await createPlayer('unlocked-storage@example.com', 'unlocked-storage');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 2 });

    const response = await startConstruction(cookie, planet.id, { key: 'alloyStorage' }).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyStorage', targetLevel: 1 });
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it('returns prerequisite details without deducting, synchronising, queueing, or scheduling', async () => {
    const { user, cookie } = await createPlayer('locked-storage@example.com', 'locked-storage');
    const previousProductionAt = new Date(NOW.getTime() - 3_600_000);
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 900,
      heliox: 800,
      aether: 700,
      alloyMineLevel: 1,
      lastProductionAt: previousProductionAt,
    });

    const response = await startConstruction(cookie, planet.id, { key: 'alloyStorage' }).expect(409);

    expect(response.body).toEqual({
      error: 'Building prerequisites have not been met.',
      code: 'PREREQUISITES_NOT_MET',
      details: {
        requirements: [
          {
            buildingId: 'alloyMine',
            buildingName: 'Alloy Mine',
            requiredLevel: 2,
            currentLevel: 1,
          },
        ],
      },
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted).toMatchObject({
      alloy: 900,
      heliox: 800,
      aether: 700,
      lastProductionAt: previousProductionAt,
    });
    expect(
      (await prisma.building.findUniqueOrThrow({
        where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
      })).level,
    ).toBe(1);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('returns every missing prerequisite in deterministic order with current levels', async () => {
    const { user, cookie } = await createPlayer('gate-prerequisites@example.com', 'gate-prerequisites');
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 1_000,
      heliox: 1_000,
      aether: 0,
      alloyMineLevel: 2,
      helioxExtractorLevel: 1,
      aetherSynthesizerLevel: 1,
      solarArrayLevel: 0,
    });

    const response = await startConstruction(cookie, planet.id, { key: 'gateObservatory' }).expect(409);

    expect(response.body.details.requirements).toEqual([
      { buildingId: 'researchLab', buildingName: 'Research Lab', requiredLevel: 3, currentLevel: 0 },
      { buildingId: 'aetherSynthesizer', buildingName: 'Aether Synthesizer', requiredLevel: 2, currentLevel: 1 },
      { buildingId: 'solarArray', buildingName: 'Solar Array', requiredLevel: 4, currentLevel: 0 },
    ]);
  });

  it('ignores client-supplied prerequisite levels and locks a legacy building upgrade', async () => {
    const { user, cookie } = await createPlayer('legacy-prerequisites@example.com', 'legacy-prerequisites');
    const planet = await createPlanet({
      ownerId: user.id,
      researchLabLevel: 2,
      aetherSynthesizerLevel: 0,
      solarArrayLevel: 1,
    });

    const response = await startConstruction(cookie, planet.id, {
      key: 'researchLab',
      completedBuildingLevels: { aetherSynthesizer: 99, solarArray: 99 },
      prerequisitesMet: true,
    }).expect(409);

    expect(response.body.code).toBe('PREREQUISITES_NOT_MET');
    expect(response.body.details.requirements).toEqual([
      { buildingId: 'aetherSynthesizer', buildingName: 'Aether Synthesizer', requiredLevel: 1, currentLevel: 0 },
      { buildingId: 'solarArray', buildingName: 'Solar Array', requiredLevel: 2, currentLevel: 1 },
    ]);
    expect(
      (await prisma.building.findUniqueOrThrow({
        where: { planetId_key: { planetId: planet.id, key: 'researchLab' } },
      })).level,
    ).toBe(2);
  });

  it('does not allow concurrent requests to bypass a prerequisite', async () => {
    const { user, cookie } = await createPlayer('concurrent-prerequisites@example.com', 'concurrent-prerequisites');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1 });

    const responses = await Promise.all([
      startConstruction(cookie, planet.id, { key: 'alloyStorage' }),
      startConstruction(cookie, planet.id, { key: 'alloyStorage' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect(responses.every((response) => response.body.code === 'PREREQUISITES_NOT_MET')).toBe(true);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('settles an overdue prerequisite upgrade before allowing its dependent building', async () => {
    const { user, cookie } = await createPlayer('overdue-prerequisite@example.com', 'overdue-prerequisite');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1 });
    const prerequisite = await createPendingConstruction(planet.id, {
      buildingKey: 'alloyMine',
      targetLevel: 2,
      startedAt: new Date(NOW.getTime() - 120_000),
      completesAt: new Date(NOW.getTime() - 60_000),
      jobId: null,
    });

    const response = await startConstruction(cookie, planet.id, { key: 'alloyStorage' }).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyStorage', targetLevel: 1 });
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: prerequisite.id } })).status).toBe('COMPLETE');
    expect(
      (await prisma.building.findUniqueOrThrow({
        where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
      })).level,
    ).toBe(2);
  });

  it('allows an upgrade within available energy capacity', async () => {
    const { user, cookie } = await createPlayer('capacity-builder@example.com', 'capacity-builder');
    const planet = await createPlanet({ ownerId: user.id, solarArrayLevel: 1 });

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyMine', targetLevel: 1 });
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it('allows an upgrade that reaches exact energy capacity', async () => {
    const { user, cookie } = await createPlayer('exact-capacity@example.com', 'exact-capacity');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1, solarArrayLevel: 0 });

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyMine', targetLevel: 2 });
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(1);
  });

  it('reserves the final available field for an accepted construction', async () => {
    const { user, cookie } = await createPlayer('final-field@example.com', 'final-field');
    const planet = await createPlanet({
      ownerId: user.id,
      alloyMineLevel: 1,
      solarArrayLevel: 0,
      fieldCapacity: 2,
    });

    await startConstruction(cookie, planet.id, { key: 'solarArray' }).expect(201);
    const catalog = await request(app).get(`/api/planets/${planet.id}/buildings`).set('Cookie', cookie).expect(200);

    expect(catalog.body.fields).toEqual({
      capacity: 2,
      completedUsed: 1,
      reserved: 1,
      occupied: 2,
      available: 0,
      isAtCapacity: true,
      isOverCapacity: false,
      overCapacityBy: 0,
    });
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id, status: 'PENDING' } })).toBe(1);
  });

  it('rejects construction above field capacity before energy, resources, or production settlement', async () => {
    const { user, cookie } = await createPlayer('fields-full@example.com', 'fields-full');
    const previousProductionAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 0,
      heliox: 0,
      aether: 0,
      alloyMineLevel: 2,
      solarArrayLevel: 0,
      fieldCapacity: 2,
      lastProductionAt: previousProductionAt,
    });

    const response = await startConstruction(cookie, planet.id).expect(409);

    expect(response.body).toEqual({
      error: 'No planetary building fields are available.',
      code: 'PLANET_FIELDS_FULL',
      details: {
        capacity: 2,
        completedUsed: 2,
        reserved: 0,
        available: 0,
        requiredForUpgrade: 1,
      },
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect({ alloy: persisted.alloy, heliox: persisted.heliox, aether: persisted.aether }).toEqual({
      alloy: 0,
      heliox: 0,
      aether: 0,
    });
    expect(persisted.lastProductionAt).toEqual(previousProductionAt);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('ignores client-supplied field capacity and usage', async () => {
    const { user, cookie } = await createPlayer('untrusted-fields@example.com', 'untrusted-fields');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1, fieldCapacity: 1 });

    const response = await startConstruction(cookie, planet.id, {
      key: 'alloyMine',
      fieldCapacity: 999_999,
      completedUsed: 0,
      reserved: 0,
      available: 999_999,
    }).expect(409);

    expect(response.body.code).toBe('PLANET_FIELDS_FULL');
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('keeps prerequisite failures ahead of field-capacity failures', async () => {
    const { user, cookie } = await createPlayer('field-prerequisite@example.com', 'field-prerequisite');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1, fieldCapacity: 1 });

    const response = await startConstruction(cookie, planet.id, { key: 'alloyStorage' }).expect(409);

    expect(response.body.code).toBe('PREREQUISITES_NOT_MET');
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('blocks a legacy over-capacity planet without altering completed buildings', async () => {
    const { user, cookie } = await createPlayer('legacy-fields@example.com', 'legacy-fields');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 3, solarArrayLevel: 1 });
    await prisma.$executeRaw`UPDATE "Planet" SET "fieldCapacity" = 2 WHERE "id" = ${planet.id}`;

    const response = await startConstruction(cookie, planet.id, { key: 'solarArray' }).expect(409);

    expect(response.body.code).toBe('PLANET_FIELDS_FULL');
    expect(response.body.details).toMatchObject({ capacity: 2, completedUsed: 4, available: 0 });
    expect((await prisma.building.findUniqueOrThrow({
      where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
    })).level).toBe(3);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
  });

  it('serialises final-field attempts so capacity cannot be exceeded', async () => {
    const { user, cookie } = await createPlayer('concurrent-fields@example.com', 'concurrent-fields');
    const planet = await createPlanet({ ownerId: user.id, fieldCapacity: 1 });

    const responses = await Promise.all([
      startConstruction(cookie, planet.id, { key: 'solarArray' }),
      startConstruction(cookie, planet.id, { key: 'solarArray' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe('CONSTRUCTION_IN_PROGRESS');
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id, status: 'PENDING' } })).toBe(1);
  });

  it('rejects an upgrade beyond capacity without changing resources, timestamps, rows, or jobs', async () => {
    const { user, cookie } = await createPlayer('energy-blocked@example.com', 'energy-blocked');
    const previousProductionAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 500,
      heliox: 300,
      aether: 0,
      alloyMineLevel: 2,
      solarArrayLevel: 0,
      lastProductionAt: previousProductionAt,
    });

    const response = await startConstruction(cookie, planet.id).expect(409);

    expect(response.body).toEqual({
      error: 'Insufficient energy capacity for this upgrade.',
      code: 'INSUFFICIENT_ENERGY',
      details: {
        supply: 20,
        currentDemand: 20,
        projectedDemand: 30,
        shortfall: 10,
      },
    });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect({ alloy: persisted.alloy, heliox: persisted.heliox, aether: persisted.aether }).toEqual({
      alloy: 500,
      heliox: 300,
      aether: 0,
    });
    expect(persisted.lastProductionAt).toEqual(previousProductionAt);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('allows an energy-generating upgrade during an existing deficit', async () => {
    const { user, cookie } = await createPlayer('deficit-generator@example.com', 'deficit-generator');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 4, solarArrayLevel: 0 });

    const response = await startConstruction(cookie, planet.id, { key: 'solarArray' }).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'solarArray', targetLevel: 1 });
  });

  it('allows a prerequisite-eligible zero-demand facility during an existing deficit', async () => {
    const { user, cookie } = await createPlayer('deficit-facility@example.com', 'deficit-facility');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 3, solarArrayLevel: 0 });

    const response = await startConstruction(cookie, planet.id, { key: 'alloyStorage' }).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyStorage', targetLevel: 1 });
  });

  it('ignores client-supplied energy totals and projections', async () => {
    const { user, cookie } = await createPlayer('untrusted-energy@example.com', 'untrusted-energy');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 2, solarArrayLevel: 0 });

    const response = await startConstruction(cookie, planet.id, {
      key: 'alloyMine',
      energy: { supply: 999_999, demand: 0 },
      projectedSupply: 999_999,
      projectedDemand: 0,
      shortfall: 0,
    }).expect(409);

    expect(response.body.code).toBe('INSUFFICIENT_ENERGY');
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('does not allow concurrent requests to bypass the energy gate', async () => {
    const { user, cookie } = await createPlayer('concurrent-energy@example.com', 'concurrent-energy');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 2, solarArrayLevel: 0 });

    const responses = await Promise.all([
      startConstruction(cookie, planet.id),
      startConstruction(cookie, planet.id),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect(responses.every((response) => response.body.code === 'INSUFFICIENT_ENERGY')).toBe(true);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('settles an overdue generator before projecting the requested upgrade', async () => {
    const { user, cookie } = await createPlayer('overdue-energy@example.com', 'overdue-energy');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 2, solarArrayLevel: 0 });
    const overdue = await prisma.buildQueueItem.create({
      data: {
        planetId: planet.id,
        buildingKey: 'solarArray',
        targetLevel: 1,
        costAlloy: 75,
        costHeliox: 30,
        costAether: 0,
        startedAt: new Date(NOW.getTime() - 120_000),
        completesAt: new Date(NOW.getTime() - 60_000),
        status: 'PENDING',
      },
    });

    const response = await startConstruction(cookie, planet.id).expect(201);

    expect(response.body.queueItem).toMatchObject({ buildingKey: 'alloyMine', targetLevel: 3 });
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe('COMPLETE');
    expect(
      (await prisma.building.findUniqueOrThrow({
        where: { planetId_key: { planetId: planet.id, key: 'solarArray' } },
      })).level,
    ).toBe(1);
  });

  it('persists synchronised resources but creates no construction or deduction when unaffordable', async () => {
    const { user, cookie } = await createPlayer('poor-builder@example.com', 'poor-builder');
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 0,
      heliox: 0,
      aether: 0,
      alloyMineLevel: 1,
      helioxExtractorLevel: 1,
      solarArrayLevel: 1,
      lastProductionAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const response = await startConstruction(cookie, planet.id).expect(402);

    expect(response.body.code).toBe('INSUFFICIENT_RESOURCES');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(33);
    expect(persisted.heliox).toBe(22);
    expect(persisted.lastProductionAt).toEqual(NOW);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('rolls back synchronisation and deduction when construction creation fails', async () => {
    const { user, cookie } = await createPlayer('rollback-builder@example.com', 'rollback-builder');
    const previousProductionAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 500,
      heliox: 300,
      aether: 0,
      alloyMineLevel: 1,
      helioxExtractorLevel: 1,
      solarArrayLevel: 1,
      lastProductionAt: previousProductionAt,
    });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_stage_3b1_construction_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced construction insert failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_stage_3b1_construction_insert
      BEFORE INSERT ON "BuildQueueItem"
      FOR EACH ROW EXECUTE FUNCTION fail_stage_3b1_construction_insert()
    `);

    try {
      await startConstruction(cookie, planet.id).expect(500);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS fail_stage_3b1_construction_insert ON "BuildQueueItem"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_stage_3b1_construction_insert()');
    }

    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(500);
    expect(persisted.heliox).toBe(300);
    expect(persisted.aether).toBe(0);
    expect(persisted.lastProductionAt).toEqual(previousProductionAt);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('does not synchronise, deduct, or construct for the wrong owner', async () => {
    const owner = await createPlayer('construction-owner@example.com', 'construction-owner');
    const other = await createPlayer('construction-other@example.com', 'construction-other');
    const lastProductionAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const planet = await createPlanet({
      ownerId: owner.user.id,
      alloy: 500,
      heliox: 300,
      lastProductionAt,
      alloyMineLevel: 1,
    });

    const response = await startConstruction(other.cookie, planet.id).expect(404);

    expect(response.body).toEqual({ error: 'Planet not found', code: 'NOT_FOUND' });
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(500);
    expect(persisted.heliox).toBe(300);
    expect(persisted.lastProductionAt).toEqual(lastProductionAt);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id } })).toBe(0);
  });

  it('returns the stable construction-in-progress conflict for a second start', async () => {
    const { user, cookie } = await createPlayer('single-builder@example.com', 'single-builder');
    const planet = await createPlanet({ ownerId: user.id });
    await startConstruction(cookie, planet.id).expect(201);

    const response = await startConstruction(cookie, planet.id, { key: 'solarArray' }).expect(409);

    expect(response.body).toEqual({
      error: 'A building upgrade is already in progress on this planet.',
      code: 'CONSTRUCTION_IN_PROGRESS',
    });
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id, status: 'PENDING' } })).toBe(1);
  });

  it('serialises concurrent starts into one construction and one deduction', async () => {
    const { user, cookie } = await createPlayer('concurrent-builder@example.com', 'concurrent-builder');
    const planet = await createPlanet({ ownerId: user.id, alloy: 500, heliox: 300, aether: 0 });

    const responses = await Promise.all([
      startConstruction(cookie, planet.id),
      startConstruction(cookie, planet.id),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.buildQueueItem.count({ where: { planetId: planet.id, status: 'PENDING' } })).toBe(1);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(440);
    expect(persisted.heliox).toBe(285);
  });

  it('cannot drive balances negative under concurrent starts', async () => {
    const { user, cookie } = await createPlayer('zero-floor-builder@example.com', 'zero-floor-builder');
    const planet = await createPlanet({ ownerId: user.id, alloy: 60, heliox: 15, aether: 0 });

    const responses = await Promise.all([
      startConstruction(cookie, planet.id),
      startConstruction(cookie, planet.id),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(0);
    expect(persisted.heliox).toBe(0);
    expect(persisted.aether).toBe(0);
  });

  it('allows construction on separate planets independently', async () => {
    const { user, cookie } = await createPlayer('multi-planet-builder@example.com', 'multi-planet-builder');
    const first = await createPlanet({ ownerId: user.id, alloy: 500, heliox: 300, aether: 0 });
    const second = await createPlanet({ ownerId: user.id, alloy: 400, heliox: 200, aether: 0 });

    const responses = await Promise.all([
      startConstruction(cookie, first.id),
      startConstruction(cookie, second.id),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await prisma.buildQueueItem.count({ where: { status: 'PENDING' } })).toBe(2);
    const [persistedFirst, persistedSecond] = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect([persistedFirst.alloy, persistedSecond.alloy]).toEqual([440, 340]);
    expect([persistedFirst.heliox, persistedSecond.heliox]).toEqual([285, 185]);
  });
});

describe('atomic building construction cancellation', () => {
  it('releases a reserved field after cancellation', async () => {
    const { user, cookie } = await createPlayer('field-canceller@example.com', 'field-canceller');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 1, fieldCapacity: 2 });
    const accepted = await startConstruction(cookie, planet.id, { key: 'solarArray' }).expect(201);
    const during = await request(app).get(`/api/planets/${planet.id}/buildings`).set('Cookie', cookie).expect(200);

    expect(during.body.fields).toMatchObject({ completedUsed: 1, reserved: 1, occupied: 2, available: 0 });
    await cancelConstruction(cookie, planet.id, accepted.body.queueItem.id).expect(200);
    const after = await request(app).get(`/api/planets/${planet.id}/buildings`).set('Cookie', cookie).expect(200);
    expect(after.body.fields).toMatchObject({ completedUsed: 1, reserved: 0, occupied: 1, available: 1 });
  });

  it('synchronises and refunds 50% of the stored cost, then tolerates Redis removal failure', async () => {
    const { user, cookie } = await createPlayer('stored-refund@example.com', 'stored-refund');
    const planet = await createPlanet({
      ownerId: user.id,
      alloy: 100,
      heliox: 100,
      aether: 10,
      alloyMineLevel: 1,
      helioxExtractorLevel: 1,
      solarArrayLevel: 1,
      lastProductionAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const item = await createPendingConstruction(planet.id, {
      costAlloy: 101,
      costHeliox: 31,
      costAether: 9,
      jobId: null,
    });
    getJob.mockImplementationOnce(async (jobId) => {
      expect(jobId).toBe(buildCompletionJobId(item.id));
      const committed = await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(committed.status).toBe('CANCELLED');
      return { remove: removeJob } as never;
    });
    removeJob.mockRejectedValueOnce(new Error('Redis unavailable'));

    const response = await cancelConstruction(cookie, planet.id, item.id).expect(200);

    expect(response.body.message).toBe('Cancelled, 50% of resources refunded');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(184);
    expect(persisted.heliox).toBe(138);
    expect(persisted.aether).toBe(15);
    expect(persisted.lastProductionAt).toEqual(NOW);
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('CANCELLED');
  });

  it('issues one refund for two concurrent cancellations', async () => {
    const { user, cookie } = await createPlayer('concurrent-canceller@example.com', 'concurrent-canceller');
    const planet = await createPlanet({ ownerId: user.id, alloy: 440, heliox: 285, aether: 0 });
    const item = await createPendingConstruction(planet.id);

    const responses = await Promise.all([
      cancelConstruction(cookie, planet.id, item.id),
      cancelConstruction(cookie, planet.id, item.id),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(470);
    expect(persisted.heliox).toBe(293);
  });

  it('returns a stable conflict and no second refund for repeated cancellation', async () => {
    const { user, cookie } = await createPlayer('repeat-canceller@example.com', 'repeat-canceller');
    const planet = await createPlanet({ ownerId: user.id, alloy: 440, heliox: 285, aether: 0 });
    const item = await createPendingConstruction(planet.id);
    await cancelConstruction(cookie, planet.id, item.id).expect(200);
    const afterFirst = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });

    const response = await cancelConstruction(cookie, planet.id, item.id).expect(409);

    expect(response.body).toEqual({
      error: 'This building upgrade can no longer be cancelled.',
      code: 'CONSTRUCTION_NOT_CANCELLABLE',
    });
    const afterSecond = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(afterSecond.alloy).toBe(afterFirst.alloy);
    expect(afterSecond.heliox).toBe(afterFirst.heliox);
  });

  it('returns the same conflict for a completed construction', async () => {
    const { user, cookie } = await createPlayer('completed-canceller@example.com', 'completed-canceller');
    const planet = await createPlanet({ ownerId: user.id, alloy: 440, heliox: 285, aether: 0 });
    const item = await createPendingConstruction(planet.id, { status: 'COMPLETE' });

    const response = await cancelConstruction(cookie, planet.id, item.id).expect(409);

    expect(response.body.code).toBe('CONSTRUCTION_NOT_CANCELLABLE');
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(440);
    expect(persisted.heliox).toBe(285);
  });

  it('does not change the completed building level when cancelling', async () => {
    const { user, cookie } = await createPlayer('level-canceller@example.com', 'level-canceller');
    const planet = await createPlanet({ ownerId: user.id, alloyMineLevel: 4 });
    const item = await createPendingConstruction(planet.id);

    await cancelConstruction(cookie, planet.id, item.id).expect(200);

    const building = await prisma.building.findUniqueOrThrow({
      where: { planetId_key: { planetId: planet.id, key: 'alloyMine' } },
    });
    expect(building.level).toBe(4);
  });
});

describe('building completion queue boundary', () => {
  it('schedules BullMQ only after the construction and deduction commit', async () => {
    const { user, cookie } = await createPlayer('commit-boundary@example.com', 'commit-boundary');
    const planet = await createPlanet({ ownerId: user.id, alloy: 500, heliox: 300, aether: 0 });
    addJob.mockImplementationOnce(async (_name, data, options) => {
      const payload = data as { queueItemId: string };
      const committedItem = await prisma.buildQueueItem.findUnique({ where: { id: payload.queueItemId } });
      const committedPlanet = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
      expect(committedItem?.status).toBe('PENDING');
      expect(committedPlanet.alloy).toBe(440);
      expect(committedPlanet.heliox).toBe(285);
      return { id: options?.jobId } as never;
    });

    await startConstruction(cookie, planet.id).expect(201);

    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it('keeps one accepted database construction when Redis scheduling fails', async () => {
    const { user, cookie } = await createPlayer('redis-failure@example.com', 'redis-failure');
    const planet = await createPlanet({ ownerId: user.id, alloy: 500, heliox: 300, aether: 0 });
    addJob.mockRejectedValue(new Error('Redis unavailable'));

    const accepted = await startConstruction(cookie, planet.id).expect(201);
    await startConstruction(cookie, planet.id).expect(409);

    expect(accepted.body.queueItem).toMatchObject({ status: 'PENDING' });
    expect(accepted.body.queueItem).not.toHaveProperty('jobId');
    const items = await prisma.buildQueueItem.findMany({ where: { planetId: planet.id } });
    expect(items).toHaveLength(1);
    expect(items[0].jobId).toBeNull();
    const persisted = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(persisted.alloy).toBe(440);
    expect(persisted.heliox).toBe(285);
  });

  it('uses the same deterministic job identifier for repeated scheduling', async () => {
    const { user, cookie } = await createPlayer('deterministic-job@example.com', 'deterministic-job');
    const planet = await createPlanet({ ownerId: user.id });
    const accepted = await startConstruction(cookie, planet.id).expect(201);
    const item = await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: accepted.body.queueItem.id } });
    addJob.mockClear();

    await scheduleBuildCompletion(item);
    await scheduleBuildCompletion(item);

    expect(addJob).toHaveBeenCalledTimes(2);
    const firstOptions = addJob.mock.calls[0][2];
    const secondOptions = addJob.mock.calls[1][2];
    expect(firstOptions?.jobId).toBe(buildCompletionJobId(item.id));
    expect(secondOptions?.jobId).toBe(buildCompletionJobId(item.id));
    expect(firstOptions?.jobId).toBe(secondOptions?.jobId);
  });
});

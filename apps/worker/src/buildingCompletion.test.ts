import { DelayedError, Job } from 'bullmq';
import {
  BuildingCompletionInvariantError,
  buildingCost,
  hourlyProduction,
} from '@eonrover/shared';
import { completeBuildingConstruction } from './buildingCompletion';
import { prisma } from './prisma';
import { processBuildJob } from './processors/buildProcessor';

const PROCESSING_TIME = new Date('2026-09-05T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
let coordinate = 1;

interface CompletionFixtureOptions {
  buildingKey?: string;
  currentLevel?: number;
  targetLevel?: number;
  completesAt?: Date;
  lastProductionAt?: Date;
  resources?: { alloy: number; heliox: number; aether: number };
  additionalBuildings?: Record<string, number>;
  status?: 'PENDING' | 'COMPLETE' | 'CANCELLED';
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(PROCESSING_TIME);
  coordinate = 1;
});

afterEach(() => {
  jest.useRealTimers();
});

async function createCompletionFixture(options: CompletionFixtureOptions = {}) {
  const buildingKey = options.buildingKey ?? 'alloyMine';
  const currentLevel = options.currentLevel ?? 0;
  const completesAt = options.completesAt ?? PROCESSING_TIME;
  const user = await prisma.user.create({
    data: {
      email: `building-completion-${coordinate}@example.com`,
      username: `building-completion-${coordinate}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: PROCESSING_TIME,
    },
  });
  const levels = { ...(options.additionalBuildings ?? {}), [buildingKey]: currentLevel };
  const planet = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `Completion Planet ${coordinate}`,
      galaxy: 8,
      system: 1,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: options.resources?.alloy ?? 100,
      heliox: options.resources?.heliox ?? 100,
      aether: options.resources?.aether ?? 0,
      lastProductionAt: options.lastProductionAt ?? new Date(completesAt.getTime() - HOUR_MS),
      buildings: {
        create: Object.entries(levels).map(([key, level]) => ({ key, level })),
      },
    },
  });
  const knownKey = buildingKey in {
    alloyMine: true,
    helioxExtractor: true,
    aetherSynthesizer: true,
    solarArray: true,
    alloyStorage: true,
    helioxStorage: true,
    aetherStorage: true,
    shipyard: true,
    researchLab: true,
    gateObservatory: true,
  };
  const cost = knownKey ? buildingCost(buildingKey as Parameters<typeof buildingCost>[0], currentLevel + 1) : {
    alloy: 0,
    heliox: 0,
    aether: 0,
  };
  const construction = await prisma.buildQueueItem.create({
    data: {
      planetId: planet.id,
      buildingKey,
      targetLevel: options.targetLevel ?? currentLevel + 1,
      costAlloy: cost.alloy,
      costHeliox: cost.heliox,
      costAether: cost.aether,
      startedAt: new Date(completesAt.getTime() - HOUR_MS),
      completesAt,
      status: options.status ?? 'PENDING',
    },
  });
  return { user, planet, construction };
}

async function completionState(planetId: string, constructionId: string) {
  const [planet, construction, buildings, notifications] = await Promise.all([
    prisma.planet.findUniqueOrThrow({ where: { id: planetId } }),
    prisma.buildQueueItem.findUniqueOrThrow({ where: { id: constructionId } }),
    prisma.building.findMany({ where: { planetId } }),
    prisma.notification.findMany({ where: { type: 'BUILDING_COMPLETE' } }),
  ]);
  return { planet, construction, buildings, notifications };
}

describe('authoritative building completion', () => {
  it('completes exactly at the persisted finish time', async () => {
    const fixture = await createCompletionFixture();

    const result = await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    expect(result).toEqual({ outcome: 'completed', legacyPastFinish: false });
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.construction.status).toBe('COMPLETE');
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(1);
    expect(state.planet.alloy).toBe(100);
    expect(state.planet.lastProductionAt).toEqual(PROCESSING_TIME);
    expect(state.notifications).toHaveLength(1);
  });

  it('uses the old mine rate before finish and the new mine rate after delayed processing', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      currentLevel: 1,
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
    });

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBeCloseTo(100 + 33 + 72.6, 10);
    expect(state.planet.lastProductionAt).toEqual(PROCESSING_TIME);
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(2);
  });

  it.each([
    ['helioxExtractor', 'heliox', 22],
    ['aetherSynthesizer', 'aether', 3.3],
  ] as const)('applies the new %s production rate after finish', async (buildingKey, resource, expectedGain) => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      buildingKey,
      currentLevel: 0,
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
    });

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    const initial = resource === 'heliox' ? 100 : 0;
    expect(state.planet[resource]).toBeCloseTo(initial + expectedGain, 10);
  });

  it('recalculates energy efficiency across a solar-array transition', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      buildingKey: 'solarArray',
      currentLevel: 0,
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
      additionalBuildings: { alloyMine: 3 },
    });
    const fullRate = hourlyProduction('alloyMine', 3, 1, 1);

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBeCloseTo(100 + fullRate * (20 / 30) + fullRate, 10);
    expect(state.buildings.find((building) => building.key === 'solarArray')?.level).toBe(1);
  });

  it('uses the old storage cap before finish and the upgraded cap afterward', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      buildingKey: 'alloyStorage',
      currentLevel: 0,
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
      resources: { alloy: 9_900, heliox: 0, aether: 0 },
      additionalBuildings: { alloyMine: 10, solarArray: 10 },
    });
    const postUpgradeRate = hourlyProduction('alloyMine', 10, 1, 1);

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBeCloseTo(10_000 + postUpgradeRate, 10);
    expect(state.planet.alloy).toBeGreaterThan(10_000);
  });

  it('uses only the new storage cap when production was already settled exactly to finish', async () => {
    const fixture = await createCompletionFixture({
      buildingKey: 'alloyStorage',
      currentLevel: 0,
      lastProductionAt: PROCESSING_TIME,
      resources: { alloy: 12_000, heliox: 0, aether: 0 },
    });

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBe(12_000);
    expect(state.planet.lastProductionAt).toEqual(PROCESSING_TIME);
  });

  it('splits a non-production building transition without creating or losing resources', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      buildingKey: 'shipyard',
      currentLevel: 0,
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
      additionalBuildings: { alloyMine: 3, solarArray: 1 },
    });
    const rate = hourlyProduction('alloyMine', 3, 1, 1);

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBeCloseTo(100 + rate * 2, 10);
    expect(state.buildings.find((building) => building.key === 'shipyard')?.level).toBe(1);
  });

  it('treats immediate duplicate processing as a successful no-op', async () => {
    const fixture = await createCompletionFixture();

    await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);
    const duplicate = await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    expect(duplicate.outcome).toBe('already-complete');
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(1);
    expect(state.notifications).toHaveLength(1);
  });

  it('serialises concurrent duplicate processing into one level transition and notification', async () => {
    const fixture = await createCompletionFixture();

    const outcomes = await Promise.all([
      completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME),
      completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME),
    ]);

    expect(outcomes.map((result) => result.outcome).sort()).toEqual(['already-complete', 'completed']);
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(1);
    expect(state.notifications).toHaveLength(1);
  });

  it('treats delivery of a cancelled construction job as a no-op', async () => {
    const fixture = await createCompletionFixture({ status: 'CANCELLED' });

    const result = await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    expect(result.outcome).toBe('cancelled');
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(0);
    expect(state.notifications).toHaveLength(0);
    expect(state.planet.alloy).toBe(100);
  });

  it('reschedules an early BullMQ delivery without changing PostgreSQL state', async () => {
    const completesAt = new Date(PROCESSING_TIME.getTime() + HOUR_MS);
    const fixture = await createCompletionFixture({ completesAt });
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = {
      data: { queueItemId: fixture.construction.id },
      moveToDelayed,
    } as unknown as Job<{ queueItemId: string }>;

    await expect(processBuildJob(job, 'worker-token')).rejects.toBeInstanceOf(DelayedError);

    expect(moveToDelayed).toHaveBeenCalledWith(completesAt.getTime(), 'worker-token');
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.construction.status).toBe('PENDING');
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(0);
    expect(state.notifications).toHaveLength(0);
  });

  it('preserves legacy resources already settled past finish and applies only the remaining new-rate segment', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const legacyTimestamp = new Date(finish.getTime() + HOUR_MS / 2);
    const fixture = await createCompletionFixture({
      completesAt: finish,
      lastProductionAt: legacyTimestamp,
      resources: { alloy: 123, heliox: 45, aether: 6 },
    });

    const result = await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    expect(result).toEqual({ outcome: 'completed', legacyPastFinish: true });
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBeCloseTo(123 + 16.5, 10);
    expect(state.planet.heliox).toBe(45);
    expect(state.planet.aether).toBe(6);
    expect(state.planet.lastProductionAt).toEqual(PROCESSING_TIME);
  });

  it('does not subtract an unexplained above-cap legacy balance', async () => {
    const finish = new Date(PROCESSING_TIME.getTime() - HOUR_MS);
    const fixture = await createCompletionFixture({
      completesAt: finish,
      lastProductionAt: new Date(finish.getTime() + HOUR_MS / 2),
      resources: { alloy: 12_000, heliox: 100, aether: 0 },
    });

    const result = await completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME);

    expect(result).toEqual({ outcome: 'completed', legacyPastFinish: true });
    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.planet.alloy).toBe(12_000);
  });

  it('rejects an invalid persisted target without partial completion effects', async () => {
    const fixture = await createCompletionFixture({ currentLevel: 1, targetLevel: 4 });

    await expect(
      completeBuildingConstruction(fixture.construction.id, PROCESSING_TIME),
    ).rejects.toBeInstanceOf(BuildingCompletionInvariantError);

    const state = await completionState(fixture.planet.id, fixture.construction.id);
    expect(state.construction.status).toBe('PENDING');
    expect(state.buildings.find((building) => building.key === 'alloyMine')?.level).toBe(1);
    expect(state.notifications).toHaveLength(0);
    expect(state.planet.alloy).toBe(100);
  });
});

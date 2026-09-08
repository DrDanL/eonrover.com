import { AppError } from '../middleware/error';
import { connection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { provisionRegistration } from './registrationService';
import { completeCanonicalColonization } from './colonizationCompletionService';
import { launchCanonicalColonization } from './colonizationLaunchService';
import { invalidateUniverseConfigCache } from './gameConfig';

let nextSystem = 200;

beforeEach(() => {
  nextSystem = 200;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function player(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
}

async function originPlanet(ownerId: string, label: string, options: { galaxy?: number; system?: number; slot?: number } = {}) {
  const planet = await prisma.planet.create({
    data: {
      ownerId,
      name: label,
      galaxy: options.galaxy ?? 9,
      system: options.system ?? nextSystem++,
      slot: options.slot ?? 1,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 5_000,
      heliox: 5_000,
      aether: 1_000,
      lastProductionAt: new Date(),
    },
  });
  await prisma.ship.create({ data: { planetId: planet.id, key: 'colonyShip', count: 1 } });
  return planet;
}

async function fixture() {
  const owner = await player(`colonization-completion-${nextSystem}`);
  const origin = await originPlanet(owner.id, 'Colonization completion origin');
  return { owner, origin };
}

async function launchedDueMission(data: Awaited<ReturnType<typeof fixture>>, targetSlot = 4) {
  const accepted = await launchCanonicalColonization({
    accountId: data.owner.id,
    originPlanetId: data.origin.id,
    targetSlot,
  });
  return { ...accepted, dueTime: new Date(accepted.arrivesAt.getTime() + 1) };
}

describe('completeCanonicalColonization', () => {
  it('creates one owned colony from persisted canonical snapshots at the authoritative completion time', async () => {
    const data = await fixture();
    const accepted = await launchedDueMission(data);
    const [originAfterLaunch, shipsAfterLaunch, redisBefore] = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } }),
      connection.keys('*'),
    ]);
    const missionBefore = await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } });

    expect(await completeCanonicalColonization(accepted.missionId, accepted.dueTime)).toBe('completed');

    const [mission, colony, buildings, originAfter, originShips] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { galaxy_system_slot: accepted.target } }),
      prisma.building.findMany({ where: { planet: { galaxy: accepted.target.galaxy, system: accepted.target.system, slot: accepted.target.slot } }, orderBy: { key: 'asc' } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } }),
    ]);
    expect(colony).toMatchObject({
      ownerId: data.owner.id,
      galaxy: accepted.target.galaxy,
      system: accepted.target.system,
      slot: accepted.target.slot,
      fieldCapacity: 180,
      alloy: 500,
      heliox: 300,
      aether: 0,
      lastProductionAt: accepted.dueTime,
    });
    const characteristics = missionBefore.colonizationCharacteristics as { planetType: string; temperature: number; solarIndex: number };
    expect(colony).toMatchObject({
      planetType: {
        temperate: 'TEMPERATE', volcanic: 'VOLCANIC', ice: 'ICE', gasGiant: 'GAS_GIANT', barren: 'BARREN', oceanic: 'OCEANIC',
      }[characteristics.planetType],
      temperature: characteristics.temperature,
      solarIndex: characteristics.solarIndex,
    });
    expect(buildings.map(({ key, level }) => ({ key, level }))).toEqual([
      { key: 'alloyMine', level: 0 },
      { key: 'helioxExtractor', level: 0 },
      { key: 'solarArray', level: 1 },
    ]);
    expect(mission).toMatchObject({
      status: 'COMPLETE',
      createdPlanetId: colony.id,
      resultSummary: { colonizationOutcome: 'FOUNDED' },
      colonizationShips: { colonyShip: 1 },
    });
    expect(originAfter).toMatchObject({ alloy: originAfterLaunch.alloy, heliox: originAfterLaunch.heliox, aether: originAfterLaunch.aether });
    expect(originShips.count).toBe(shipsAfterLaunch.count);
    expect(missionBefore.colonizationFuelHeliox).toBe(accepted.fuelHeliox);
    expect(await prisma.notification.count({ where: { userId: data.owner.id, type: 'COLONY_FOUNDED' } })).toBe(1);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect((await connection.keys('*')).sort()).toEqual(redisBefore.sort());
  });

  it('returns early without changing a canonical outbound reservation', async () => {
    const data = await fixture();
    const accepted = await launchedDueMission(data);
    const before = await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } });
    const originShips = await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } });

    expect(await completeCanonicalColonization(accepted.missionId, new Date(accepted.arrivesAt.getTime() - 1))).toBe('early');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'OUTBOUND', createdPlanetId: null });
    expect(await prisma.planet.count({ where: { galaxy: accepted.target.galaxy, system: accepted.target.system, slot: accepted.target.slot } })).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: originShips.count });
    expect(await prisma.notification.count()).toBe(0);
    expect(before.status).toBe('OUTBOUND');
  });

  it('serializes duplicate and concurrent arrival delivery into one colony and one notification', async () => {
    const data = await fixture();
    const accepted = await launchedDueMission(data);
    const outcomes = await Promise.all([
      completeCanonicalColonization(accepted.missionId, accepted.dueTime),
      completeCanonicalColonization(accepted.missionId, accepted.dueTime),
      completeCanonicalColonization(accepted.missionId, accepted.dueTime),
    ]);

    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(1);
    expect(await prisma.planet.count({ where: { ownerId: data.owner.id } })).toBe(2);
    expect(await prisma.planet.count({ where: { galaxy: accepted.target.galaxy, system: accepted.target.system, slot: accepted.target.slot } })).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.notification.count({ where: { userId: data.owner.id, type: 'COLONY_FOUNDED' } })).toBe(1);
  });

  it('ignores missing, terminal, recalled, malformed, and legacy rows without side effects', async () => {
    expect(await completeCanonicalColonization('missing-mission', new Date())).toBe('noop');

    const terminal = await fixture();
    const terminalAccepted = await launchedDueMission(terminal);
    await prisma.fleetMission.update({ where: { id: terminalAccepted.missionId }, data: { status: 'COMPLETE' } });
    expect(await completeCanonicalColonization(terminalAccepted.missionId, terminalAccepted.dueTime)).toBe('noop');

    const recalled = await fixture();
    const recalledAccepted = await launchedDueMission(recalled);
    await prisma.fleetMission.update({ where: { id: recalledAccepted.missionId }, data: { status: 'RECALLED' } });
    expect(await completeCanonicalColonization(recalledAccepted.missionId, recalledAccepted.dueTime)).toBe('noop');

    const malformed = await fixture();
    const malformedAccepted = await launchedDueMission(malformed);
    await prisma.fleetMission.update({ where: { id: malformedAccepted.missionId }, data: { colonizationStarterState: { resources: { alloy: 999 } } } });
    expect(await completeCanonicalColonization(malformedAccepted.missionId, malformedAccepted.dueTime)).toBe('noop');

    const legacy = await fixture();
    const legacyMission = await prisma.fleetMission.create({
      data: {
        originId: legacy.origin.id,
        targetGalaxy: legacy.origin.galaxy,
        targetSystem: legacy.origin.system,
        targetSlot: 4,
        missionType: 'COLONIZE',
        ships: { colonyShip: 99 },
        cargo: { heliox: 99 },
        arrivesAt: new Date(),
      },
    });
    expect(await completeCanonicalColonization(legacyMission.id, new Date())).toBe('noop');
    expect(await prisma.planet.count({ where: { ownerId: { in: [terminal.owner.id, recalled.owner.id, malformed.owner.id, legacy.owner.id] } } })).toBe(4);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('marks an unexpectedly occupied target terminally failed, restores one Colony Ship, and never refunds Heliox twice', async () => {
    const data = await fixture();
    const accepted = await launchedDueMission(data);
    const beforeFailure = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    const intruder = await player('colonization-target-intruder');
    await prisma.planet.create({
      data: {
        ownerId: intruder.id,
        name: 'Unexpected target occupant',
        ...accepted.target,
        planetType: 'BARREN',
        temperature: -20,
        solarIndex: 0.3,
      },
    });

    expect(await completeCanonicalColonization(accepted.missionId, accepted.dueTime)).toBe('failed');
    expect(await completeCanonicalColonization(accepted.missionId, accepted.dueTime)).toBe('noop');

    const [mission, origin, ships] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } }),
    ]);
    expect(mission).toMatchObject({ status: 'COMPLETE', createdPlanetId: null, resultSummary: { colonizationOutcome: 'TARGET_OCCUPIED' } });
    expect(ships.count).toBe(1);
    expect(origin.heliox).toBe(beforeFailure.heliox);
    expect(await prisma.notification.count({ where: { userId: data.owner.id, type: 'COLONY_FAILED' } })).toBe(1);
    expect(await prisma.planet.count({ where: { galaxy: accepted.target.galaxy, system: accepted.target.system, slot: accepted.target.slot } })).toBe(1);
  });

  it('shares the coordinate lock with registration so the target can be claimed only once', async () => {
    const data = await fixture();
    const accepted = await launchedDueMission(data);
    const registration = provisionRegistration({
      email: 'colonization-completion-registration@example.invalid',
      username: 'colonization-completion-registration',
      passwordHash: 'not-used',
      verificationToken: 'test-verification-token',
      protectionHours: 72,
      now: accepted.dueTime,
    }, {
      coordinateGenerator: () => accepted.target,
      maxCoordinateAttempts: 1,
    });
    const results = await Promise.allSettled([
      completeCanonicalColonization(accepted.missionId, accepted.dueTime),
      registration,
    ]);

    expect(await prisma.planet.count({ where: { galaxy: accepted.target.galaxy, system: accepted.target.system, slot: accepted.target.slot } })).toBe(1);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(failures.length).toBeLessThanOrEqual(1);
    expect(failures.every((result) => result.reason instanceof AppError)).toBe(true);
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } });
    expect(mission.status).toBe('COMPLETE');
    expect(await prisma.notification.count({ where: { userId: data.owner.id, type: { in: ['COLONY_FOUNDED', 'COLONY_FAILED'] } } })).toBe(1);
  });
});

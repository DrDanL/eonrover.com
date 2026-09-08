import {
  COLONY_STARTER_STATE,
  deriveColonyCharacteristics,
  planSameSystemColonization,
} from '@eonrover/shared';
import { colonizationArrivalQueue } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { invalidateUniverseConfigCache, setUniverseConfigValue } from './gameConfig';
import {
  ColonizationLaunchInput,
  launchCanonicalColonization,
} from './colonizationLaunchService';
import { colonizationArrivalJobId } from './colonizationArrivalSchedulingService';

let nextSystem = 100;

beforeEach(() => {
  nextSystem = 100;
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

async function originPlanet(
  ownerId: string,
  label: string,
  options: {
    galaxy?: number;
    system?: number;
    slot?: number;
    heliox?: number;
    colonyShips?: number;
  } = {},
) {
  const planet = await prisma.planet.create({
    data: {
      ownerId,
      name: label,
      galaxy: options.galaxy ?? 5,
      system: options.system ?? nextSystem++,
      slot: options.slot ?? 1,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 20_000,
      heliox: options.heliox ?? 5_000,
      aether: 2_000,
      lastProductionAt: new Date(),
    },
  });
  if (options.colonyShips !== undefined) {
    await prisma.ship.create({ data: { planetId: planet.id, key: 'colonyShip', count: options.colonyShips } });
  }
  return planet;
}

async function fixture(options: Parameters<typeof originPlanet>[2] = {}) {
  const owner = await player(`colonization-owner-${nextSystem}`);
  const origin = await originPlanet(owner.id, 'Colonization origin', { colonyShips: 1, ...options });
  return { owner, origin };
}

function input(fixtureValue: Awaited<ReturnType<typeof fixture>>, targetSlot = 4): ColonizationLaunchInput {
  return { accountId: fixtureValue.owner.id, originPlanetId: fixtureValue.origin.id, targetSlot };
}

function starterStateSnapshot() {
  return {
    fieldCapacity: COLONY_STARTER_STATE.fieldCapacity,
    resources: { ...COLONY_STARTER_STATE.resources },
    buildings: { ...COLONY_STARTER_STATE.buildings },
  };
}

async function expectServiceError(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({ name: 'ColonizationLaunchError', code });
}

async function canonicalReservation(
  accountId: string,
  originId: string,
  target: { galaxy: number; system: number; slot: number },
) {
  return prisma.fleetMission.create({
    data: {
      originId,
      targetGalaxy: target.galaxy,
      targetSystem: target.system,
      targetSlot: target.slot,
      missionType: 'COLONIZE',
      ships: { colonyShip: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      speedPercent: 100,
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      status: 'OUTBOUND',
      colonizationAccountId: accountId,
      colonizationTargetGalaxy: target.galaxy,
      colonizationTargetSystem: target.system,
      colonizationTargetSlot: target.slot,
      colonizationShips: { colonyShip: 1 },
      colonizationFuelHeliox: 10,
      colonizationDurationSeconds: 60,
      colonizationCharacteristics: { planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, fieldCapacity: 180 },
      colonizationStarterState: starterStateSnapshot(),
    },
  });
}

describe('launchCanonicalColonization', () => {
  it('atomically reserves one Colony Ship and the authoritative Heliox cost with only canonical snapshots', async () => {
    const candidate = await fixture({ colonyShips: 2 });
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const plan = planSameSystemColonization({
      origin: candidate.origin,
      targetSlot: 4,
      ships: { colonyShip: 1 },
      fleetSpeed: 1,
    });
    const accepted = await launchCanonicalColonization(input(candidate));

    const [mission, originAfter, ships] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'colonyShip' } } }),
    ]);
    expect(Object.keys(accepted).sort()).toEqual(['arrivesAt', 'departedAt', 'durationSeconds', 'fuelHeliox', 'missionId', 'originPlanetId', 'schedulingOutcome', 'status', 'target']);
    expect(accepted).toMatchObject({
      originPlanetId: candidate.origin.id,
      target: plan.target,
      fuelHeliox: plan.fuelHeliox,
      durationSeconds: plan.durationSeconds,
      status: 'OUTBOUND',
    });
    expect(accepted.arrivesAt.getTime() - accepted.departedAt.getTime()).toBe(plan.durationSeconds * 1_000);
    expect(mission).toMatchObject({
      originId: candidate.origin.id,
      targetId: null,
      targetGalaxy: plan.target.galaxy,
      targetSystem: plan.target.system,
      targetSlot: plan.target.slot,
      missionType: 'COLONIZE',
      ships: { colonyShip: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      speedPercent: 100,
      status: 'OUTBOUND',
      jobId: null,
      colonizationAccountId: candidate.owner.id,
      colonizationTargetGalaxy: plan.target.galaxy,
      colonizationTargetSystem: plan.target.system,
      colonizationTargetSlot: plan.target.slot,
      colonizationShips: { colonyShip: 1 },
      colonizationFuelHeliox: plan.fuelHeliox,
      colonizationDurationSeconds: plan.durationSeconds,
      colonizationCharacteristics: deriveColonyCharacteristics(accepted.missionId),
      colonizationStarterState: COLONY_STARTER_STATE,
      createdPlanetId: null,
    });
    expect(ships.count).toBe(1);
    expect(originAfter.heliox).toBe(beforeOrigin.heliox - plan.fuelHeliox);
    expect(await prisma.planet.count({ where: { ownerId: candidate.owner.id } })).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(accepted.schedulingOutcome).toBe('scheduled');
    const wakeup = await colonizationArrivalQueue.getJob(colonizationArrivalJobId(accepted.missionId));
    expect(wakeup).toBeDefined();
    await wakeup?.remove();
    expect(await colonizationArrivalQueue.getJob(colonizationArrivalJobId(accepted.missionId))).toBeUndefined();
  });

  it('rejects client-like spoofed fields and invalid targets without reserving ships or Heliox', async () => {
    const candidate = await fixture();
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const beforeShips = await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'colonyShip' } } });

    await expectServiceError(launchCanonicalColonization({
      ...input(candidate),
      ships: { colonyShip: 99 },
      speedPercent: 1,
      cargo: { heliox: 1 },
      fuelHeliox: 0,
      durationSeconds: 1,
      colonizationCharacteristics: { planetType: 'GAS_GIANT' },
    } as unknown as ColonizationLaunchInput), 'INVALID_TARGET');
    for (const targetSlot of [0, 1, 13, 1.5, '4']) {
      await expectServiceError(launchCanonicalColonization({ ...input(candidate), targetSlot }), 'INVALID_TARGET');
    }

    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({ heliox: before.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: beforeShips.count });
  });

  it('rejects occupied and reserved targets without side effects', async () => {
    const occupiedCandidate = await fixture();
    await originPlanet(await player('occupying-owner').then(({ id }) => id), 'Occupied target', {
      galaxy: occupiedCandidate.origin.galaxy,
      system: occupiedCandidate.origin.system,
      slot: 4,
    });
    await expectServiceError(launchCanonicalColonization(input(occupiedCandidate)), 'TARGET_OCCUPIED');

    const reservationCandidate = await fixture();
    const reservingOwner = await player('reserving-owner');
    const reservingOrigin = await originPlanet(reservingOwner.id, 'Reserving origin', {
      galaxy: reservationCandidate.origin.galaxy,
      system: reservationCandidate.origin.system,
      slot: 2,
    });
    await canonicalReservation(reservingOwner.id, reservingOrigin.id, {
      galaxy: reservationCandidate.origin.galaxy,
      system: reservationCandidate.origin.system,
      slot: 4,
    });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: reservationCandidate.origin.id } });
    await expectServiceError(launchCanonicalColonization(input(reservationCandidate)), 'TARGET_RESERVED');

    expect(await prisma.fleetMission.count({ where: { colonizationAccountId: reservationCandidate.owner.id } })).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: reservationCandidate.origin.id } })).toMatchObject({ heliox: before.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: reservationCandidate.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
  });

  it('rejects insufficient Colony Ships and Heliox without mutations', async () => {
    const noShip = await fixture({ colonyShips: 0 });
    await expectServiceError(launchCanonicalColonization(input(noShip)), 'INSUFFICIENT_COLONY_SHIPS');
    expect(await prisma.fleetMission.count()).toBe(0);

    const noFuel = await fixture({ heliox: 0, colonyShips: 1 });
    await expectServiceError(launchCanonicalColonization(input(noFuel)), 'INSUFFICIENT_HELIOX');
    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: noFuel.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
  });

  it('serializes concurrent same-account launches so ships and Heliox are reserved once', async () => {
    const candidate = await fixture({ colonyShips: 1 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const results = await Promise.allSettled([
      launchCanonicalColonization(input(candidate, 4)),
      launchCanonicalColonization(input(candidate, 5)),
    ]);
    const successes = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof launchCanonicalColonization>>> => result.status === 'fulfilled');
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ name: 'ColonizationLaunchError', code: 'COLONIZATION_IN_PROGRESS' });
    const acceptedPlan = planSameSystemColonization({
      origin: candidate.origin,
      targetSlot: successes[0].value.target.slot,
      ships: { colonyShip: 1 },
      fleetSpeed: 1,
    });
    expect(await prisma.fleetMission.count({ where: { colonizationAccountId: candidate.owner.id, status: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 0 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({ heliox: before.heliox - acceptedPlan.fuelHeliox });
  });

  it('serializes concurrent same-target reservations across accounts', async () => {
    const firstOwner = await player('target-race-first');
    const secondOwner = await player('target-race-second');
    const firstOrigin = await originPlanet(firstOwner.id, 'First target race origin', { galaxy: 7, system: 77, slot: 1, colonyShips: 1 });
    const secondOrigin = await originPlanet(secondOwner.id, 'Second target race origin', { galaxy: 7, system: 77, slot: 2, colonyShips: 1 });
    const results = await Promise.allSettled([
      launchCanonicalColonization({ accountId: firstOwner.id, originPlanetId: firstOrigin.id, targetSlot: 4 }),
      launchCanonicalColonization({ accountId: secondOwner.id, originPlanetId: secondOrigin.id, targetSlot: 4 }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(failure?.reason).toMatchObject({ name: 'ColonizationLaunchError', code: 'TARGET_RESERVED' });
    expect(await prisma.fleetMission.count({ where: { colonizationTargetGalaxy: 7, colonizationTargetSystem: 77, colonizationTargetSlot: 4, status: 'OUTBOUND' } })).toBe(1);
  });

  it('counts outbound canonical reservations toward the configured planet limit', async () => {
    const candidate = await fixture({ galaxy: 8, system: 88, slot: 1 });
    await setUniverseConfigValue('maxPlanetsPerPlayer', 2);
    await canonicalReservation(candidate.owner.id, candidate.origin.id, { galaxy: 8, system: 88, slot: 4 });

    await expectServiceError(launchCanonicalColonization(input(candidate, 5)), 'PLANET_LIMIT_REACHED');
    expect(await prisma.fleetMission.count({ where: { colonizationAccountId: candidate.owner.id, status: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
  });
});

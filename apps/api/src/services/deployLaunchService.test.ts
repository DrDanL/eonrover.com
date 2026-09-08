import { planDeploy } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { fleetQueue } from '../lib/redis';
import { DeployLaunchInput, launchOwnedPlanetDeploy } from './deployLaunchService';
import { invalidateUniverseConfigCache } from './gameConfig';

let coordinate = 1;

beforeEach(() => {
  coordinate = 1;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function createPlayer(label: string) {
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

async function createPlanet(ownerId: string, name: string, heliox = 5_000) {
  const slot = coordinate++;
  return prisma.planet.create({
    data: {
      ownerId,
      name,
      galaxy: 1,
      system: 1,
      slot,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 50_000,
      heliox,
      aether: 4_000,
      lastProductionAt: new Date(),
    },
  });
}

async function ownedDeployFixture(options: { heliox?: number; scouts?: number; transporters?: number } = {}) {
  const owner = await createPlayer(`deploy-owner-${coordinate}`);
  const origin = await createPlanet(owner.id, 'Deploy Origin', options.heliox);
  const destination = await createPlanet(owner.id, 'Deploy Destination');
  if (options.scouts !== undefined) await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: options.scouts } });
  if (options.transporters !== undefined) await prisma.ship.create({ data: { planetId: origin.id, key: 'transporter', count: options.transporters } });
  return { owner, origin, destination };
}

function input(fixture: Awaited<ReturnType<typeof ownedDeployFixture>>, ships: unknown = { scout: 2 }): DeployLaunchInput {
  return {
    accountId: fixture.owner.id,
    originPlanetId: fixture.origin.id,
    destinationPlanetId: fixture.destination.id,
    speedPercent: 100,
    ships,
  };
}

async function expectServiceError(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({ name: 'DeployLaunchError', code });
}

describe('launchOwnedPlanetDeploy', () => {
  it('persists canonical snapshots while atomically reserving only origin ships and Heliox', async () => {
    const fixture = await ownedDeployFixture({ scouts: 5, transporters: 3 });
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } });
    const addJob = jest.spyOn(fleetQueue, 'add');

    const accepted = await launchOwnedPlanetDeploy(input(fixture, { transporter: 2, scout: 3 }));
    const expected = planDeploy({
      ships: { scout: 3, transporter: 2 },
      speedPercent: 100,
      origin: fixture.origin,
      destination: fixture.destination,
      fleetSpeed: 1,
    });
    const [mission, originScouts, originTransporters, destinationShips, originAfter] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'scout' } } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'transporter' } } }),
      prisma.ship.count({ where: { planetId: fixture.destination.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } }),
    ]);

    expect(accepted).toMatchObject({ originPlanetId: fixture.origin.id, destinationPlanetId: fixture.destination.id, ships: expected.ships, fuelHeliox: expected.fuelHeliox, durationSeconds: expected.durationSeconds });
    expect(accepted.arrivesAt.getTime() - accepted.departedAt.getTime()).toBe(expected.durationSeconds * 1_000);
    expect(mission).toMatchObject({
      originId: fixture.origin.id,
      targetId: fixture.destination.id,
      targetGalaxy: fixture.destination.galaxy,
      targetSystem: fixture.destination.system,
      targetSlot: fixture.destination.slot,
      missionType: 'DEPLOY',
      status: 'OUTBOUND',
      ships: expected.ships,
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      speedPercent: 100,
      deployOriginId: fixture.origin.id,
      deployDestinationId: fixture.destination.id,
      deployShips: expected.ships,
      deployFuelHeliox: expected.fuelHeliox,
      deployDurationSeconds: expected.durationSeconds,
      jobId: null,
    });
    expect(originScouts.count).toBe(2);
    expect(originTransporters.count).toBe(1);
    expect(destinationShips).toBe(0);
    expect(originAfter.heliox).toBe(beforeOrigin.heliox - expected.fuelHeliox);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
    addJob.mockRestore();
  });

  it('rejects an unowned destination and identical planets without side effects', async () => {
    const fixture = await ownedDeployFixture({ scouts: 3 });
    const other = await createPlayer('deploy-other');
    const unowned = await createPlanet(other.id, 'Not Owned');
    const before = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'scout' } } }),
    ]);
    await expectServiceError(launchOwnedPlanetDeploy({ ...input(fixture), destinationPlanetId: unowned.id }), 'DESTINATION_NOT_OWNED');
    await expectServiceError(launchOwnedPlanetDeploy({ ...input(fixture), destinationPlanetId: fixture.origin.id }), 'IDENTICAL_PLANETS');
    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } })).toMatchObject({ heliox: before[0].heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'scout' } } })).toMatchObject({ count: before[1].count });
  });

  it('rejects invalid speed, cargo, and spoofed manifests before creating a mission', async () => {
    const fixture = await ownedDeployFixture({ scouts: 3 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } });
    await expectServiceError(launchOwnedPlanetDeploy({ ...input(fixture), speedPercent: 9 }), 'INVALID_DEPLOY_INPUT');
    await expectServiceError(launchOwnedPlanetDeploy({ ...input(fixture), ships: { scout: 1, forgedShip: 1 } }), 'INVALID_DEPLOY_INPUT');
    await expectServiceError(launchOwnedPlanetDeploy({ ...input(fixture), cargo: { heliox: 1 } } as unknown as DeployLaunchInput), 'INVALID_DEPLOY_INPUT');
    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } })).toMatchObject({ heliox: before.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'scout' } } })).toMatchObject({ count: 3 });
  });

  it('rejects insufficient ships or Heliox without reserving either resource', async () => {
    const insufficientShips = await ownedDeployFixture({ scouts: 1 });
    await expectServiceError(launchOwnedPlanetDeploy(input(insufficientShips, { scout: 2 })), 'INSUFFICIENT_SHIPS');
    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: insufficientShips.origin.id, key: 'scout' } } })).toMatchObject({ count: 1 });

    const insufficientFuel = await ownedDeployFixture({ scouts: 2, heliox: 0 });
    await expectServiceError(launchOwnedPlanetDeploy(input(insufficientFuel, { scout: 1 })), 'INSUFFICIENT_HELIOX');
    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: insufficientFuel.origin.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: insufficientFuel.origin.id } })).toMatchObject({ heliox: 0 });
  });

  it('permits one outbound deploy per origin and serializes concurrent launch attempts without oversending', async () => {
    const fixture = await ownedDeployFixture({ scouts: 4 });
    const [first, second] = await Promise.allSettled([
      launchOwnedPlanetDeploy(input(fixture, { scout: 3 })),
      launchOwnedPlanetDeploy(input(fixture, { scout: 3 })),
    ]);
    const successes = [first, second].filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof launchOwnedPlanetDeploy>>> => result.status === 'fulfilled');
    const failures = [first, second].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ name: 'DeployLaunchError', code: 'DEPLOYMENT_IN_PROGRESS' });
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { originId: fixture.origin.id, missionType: 'DEPLOY', status: 'OUTBOUND' } });
    expect(await prisma.fleetMission.count({ where: { originId: fixture.origin.id, missionType: 'DEPLOY', status: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'scout' } } })).toMatchObject({ count: 1 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } })).toMatchObject({ heliox: 5_000 - mission.deployFuelHeliox! });
    await expectServiceError(launchOwnedPlanetDeploy(input(fixture, { scout: 1 })), 'DEPLOYMENT_IN_PROGRESS');
    expect(await prisma.fleetMission.count({ where: { originId: fixture.origin.id } })).toBe(1);
  });
});

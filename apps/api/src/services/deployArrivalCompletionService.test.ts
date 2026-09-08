import { prisma } from '../lib/prisma';
import { fleetQueue } from '../lib/redis';
import { completeOwnedPlanetDeployArrival } from './deployArrivalCompletionService';
import { DeployLaunchInput, launchOwnedPlanetDeploy } from './deployLaunchService';
import { invalidateUniverseConfigCache } from './gameConfig';

const DUE_TIME = new Date('2026-09-09T12:00:00.000Z');
let coordinate = 40;
let fixtureNumber = 0;

beforeEach(() => {
  coordinate = 40;
  fixtureNumber = 0;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function fixture(options: { originShips?: number; destinationShips?: number } = {}) {
  fixtureNumber += 1;
  const user = await prisma.user.create({
    data: {
      email: `deploy-arrival-${fixtureNumber}@example.invalid`,
      username: `deploy-arrival-${fixtureNumber}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const origin = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `Arrival Origin ${fixtureNumber}`,
      galaxy: 2,
      system: 2,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 4_000,
      heliox: 5_000,
      aether: 300,
      lastProductionAt: new Date(),
    },
  });
  const destination = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `Arrival Destination ${fixtureNumber}`,
      galaxy: 2,
      system: 2,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 700,
      heliox: 800,
      aether: 900,
      lastProductionAt: new Date(),
    },
  });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: options.originShips ?? 5 } });
  if (options.destinationShips !== undefined) {
    await prisma.ship.create({ data: { planetId: destination.id, key: 'scout', count: options.destinationShips } });
  }
  return { user, origin, destination };
}

function launchInput(data: Awaited<ReturnType<typeof fixture>>, ships: unknown = { scout: 2 }): DeployLaunchInput {
  return { accountId: data.user.id, originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speedPercent: 100, ships };
}

async function dueDeploy(data: Awaited<ReturnType<typeof fixture>>, ships: unknown = { scout: 2 }) {
  const accepted = await launchOwnedPlanetDeploy(launchInput(data, ships));
  await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { arrivesAt: DUE_TIME } });
  return accepted;
}

describe('completeOwnedPlanetDeployArrival', () => {
  it('completes a due canonical deploy once, creates missing destination inventory, and changes no resources', async () => {
    const data = await fixture();
    const accepted = await dueDeploy(data, { scout: 2 });
    await prisma.fleetMission.update({
      where: { id: accepted.missionId },
      data: { ships: { scout: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 } },
    });
    const [originBefore, destinationBefore] = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
    ]);
    const addJob = jest.spyOn(fleetQueue, 'add');

    expect(await completeOwnedPlanetDeployArrival(accepted.missionId, new Date(DUE_TIME.getTime() + 1))).toBe('completed');
    const [mission, destinationShip, originShip, originAfter, destinationAfter] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.destination.id, key: 'scout' } } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
    ]);
    expect(mission).toMatchObject({ status: 'COMPLETE', ships: { scout: 999 }, deployShips: { scout: 2 }, cargo: { alloy: 999, heliox: 999, aether: 999 }, jobId: null });
    expect(destinationShip.count).toBe(2);
    expect(originShip.count).toBe(3);
    expect(originAfter).toMatchObject({ alloy: originBefore.alloy, heliox: originBefore.heliox, aether: originBefore.aether });
    expect(destinationAfter).toMatchObject({ alloy: destinationBefore.alloy, heliox: destinationBefore.heliox, aether: destinationBefore.aether });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
    expect(await prisma.fleetMission.count()).toBe(1);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
    addJob.mockRestore();
  });

  it('returns early without changing a pending canonical deploy', async () => {
    const data = await fixture();
    const accepted = await launchOwnedPlanetDeploy(launchInput(data));
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
    ]);
    expect(await completeOwnedPlanetDeployArrival(accepted.missionId, new Date(accepted.arrivesAt.getTime() - 1))).toBe('early');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: data.destination.id } })).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } })).toMatchObject({ count: before[1].count });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } })).toMatchObject({ alloy: before[2].alloy, heliox: before[2].heliox, aether: before[2].aether });
    expect(await prisma.notification.count()).toBe(0);
    expect(before[0].status).toBe('OUTBOUND');
  });

  it('serializes duplicate and concurrent arrivals into one transfer and notification', async () => {
    const data = await fixture({ destinationShips: 4 });
    const accepted = await dueDeploy(data, { scout: 2 });
    const outcomes = await Promise.all([
      completeOwnedPlanetDeployArrival(accepted.missionId, new Date(DUE_TIME.getTime() + 1)),
      completeOwnedPlanetDeployArrival(accepted.missionId, new Date(DUE_TIME.getTime() + 1)),
      completeOwnedPlanetDeployArrival(accepted.missionId, new Date(DUE_TIME.getTime() + 1)),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.destination.id, key: 'scout' } } })).toMatchObject({ count: 6 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
  });

  it('treats terminal, non-deploy, legacy/incomplete, and malformed rows as no-ops', async () => {
    const terminal = await fixture();
    const terminalAccepted = await dueDeploy(terminal);
    await prisma.fleetMission.update({ where: { id: terminalAccepted.missionId }, data: { status: 'COMPLETE' } });
    expect(await completeOwnedPlanetDeployArrival(terminalAccepted.missionId, new Date(DUE_TIME.getTime() + 1))).toBe('noop');

    const nonDeploy = await fixture();
    const nonDeployMission = await prisma.fleetMission.create({ data: {
      originId: nonDeploy.origin.id, targetId: nonDeploy.destination.id, targetGalaxy: nonDeploy.destination.galaxy, targetSystem: nonDeploy.destination.system, targetSlot: nonDeploy.destination.slot,
      missionType: 'TRANSPORT', ships: { scout: 99 }, cargo: { alloy: 99 }, arrivesAt: DUE_TIME,
      deployOriginId: nonDeploy.origin.id, deployDestinationId: nonDeploy.destination.id, deployShips: { scout: 2 }, deployFuelHeliox: 1, deployDurationSeconds: 1,
    } });
    expect(await completeOwnedPlanetDeployArrival(nonDeployMission.id, new Date(DUE_TIME.getTime() + 1))).toBe('noop');

    const legacy = await fixture();
    const legacyMission = await prisma.fleetMission.create({ data: {
      originId: legacy.origin.id, targetId: legacy.destination.id, targetGalaxy: legacy.destination.galaxy, targetSystem: legacy.destination.system, targetSlot: legacy.destination.slot,
      missionType: 'DEPLOY', ships: { scout: 99 }, cargo: { heliox: 99 }, arrivesAt: DUE_TIME,
    } });
    expect(await completeOwnedPlanetDeployArrival(legacyMission.id, new Date(DUE_TIME.getTime() + 1))).toBe('noop');

    const malformed = await fixture();
    const malformedMission = await prisma.fleetMission.create({ data: {
      originId: malformed.origin.id, targetId: malformed.destination.id, targetGalaxy: malformed.destination.galaxy, targetSystem: malformed.destination.system, targetSlot: malformed.destination.slot,
      missionType: 'DEPLOY', ships: { scout: 99 }, cargo: { aether: 99 }, arrivesAt: DUE_TIME,
      deployOriginId: malformed.origin.id, deployDestinationId: malformed.destination.id, deployShips: { scout: 0 }, deployFuelHeliox: 1, deployDurationSeconds: 1,
    } });
    expect(await completeOwnedPlanetDeployArrival(malformedMission.id, new Date(DUE_TIME.getTime() + 1))).toBe('noop');
    expect(await prisma.ship.count({ where: { planetId: { in: [terminal.destination.id, nonDeploy.destination.id, legacy.destination.id, malformed.destination.id] } } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('does not transfer a canonical deploy when destination ownership becomes inconsistent', async () => {
    const data = await fixture();
    const accepted = await dueDeploy(data);
    const other = await prisma.user.create({ data: { email: 'deploy-arrival-other@example.invalid', username: 'deploy-arrival-other', passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date() } });
    await prisma.planet.update({ where: { id: data.destination.id }, data: { ownerId: other.id } });
    expect(await completeOwnedPlanetDeployArrival(accepted.missionId, new Date(DUE_TIME.getTime() + 1))).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: data.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});

import { Job } from 'bullmq';
import { prisma } from '../prisma';
import {
  DEPLOY_ARRIVAL_JOB_NAME,
  processDeployArrivalJob,
} from './deployArrivalProcessor';

let coordinate = 170;

async function canonicalDeploy(options: { arrivesAt: Date; destinationScouts?: number } = { arrivesAt: new Date(Date.now() - 1) }) {
  const user = await prisma.user.create({ data: {
    email: `deploy-worker-${coordinate}@example.invalid`, username: `deploy-worker-${coordinate}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Deploy worker origin ${coordinate}`, galaxy: 7, system: 7, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(),
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Deploy worker destination ${coordinate}`, galaxy: 7, system: 7, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(),
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: 3 } });
  if (options.destinationScouts !== undefined) {
    await prisma.ship.create({ data: { planetId: destination.id, key: 'scout', count: options.destinationScouts } });
  }
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: destination.id,
    targetGalaxy: destination.galaxy, targetSystem: destination.system, targetSlot: destination.slot,
    missionType: 'DEPLOY', ships: { scout: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 },
    speedPercent: 100, departedAt: new Date(options.arrivesAt.getTime() - 60_000), arrivesAt: options.arrivesAt,
    status: 'OUTBOUND', deployOriginId: origin.id, deployDestinationId: destination.id,
    deployShips: { scout: 2 }, deployFuelHeliox: 1, deployDurationSeconds: 60,
  } });
  return { user, origin, destination, mission };
}

function job(data: unknown, name = DEPLOY_ARRIVAL_JOB_NAME) {
  return {
    name,
    data,
    token: 'test-token',
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

describe('processDeployArrivalJob', () => {
  it('completes a due canonical deploy exactly once and ignores forged job fields', async () => {
    const fixture = await canonicalDeploy({ arrivesAt: new Date(Date.now() - 1), destinationScouts: 4 });
    const queued = job({
      missionId: fixture.mission.id,
      accountId: 'forged-account', planetId: 'forged-planet', shipType: 'transporter', quantity: 999,
    });

    expect(await processDeployArrivalJob(queued)).toBe('completed');
    expect(await processDeployArrivalJob(queued)).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.destination.id, key: 'scout' } } })).toMatchObject({ count: 6 });
    expect(await prisma.ship.count({ where: { planetId: fixture.destination.id, key: 'transporter' } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  it('reschedules an early job to its persisted arrival without state changes', async () => {
    const arrivesAt = new Date(Date.now() + 60_000);
    const fixture = await canonicalDeploy({ arrivesAt });
    const queued = job({ missionId: fixture.mission.id, arrivesAt: new Date(0), quantity: 999 });

    expect(await processDeployArrivalJob(queued)).toBe('early');
    expect(queued.moveToDelayed).toHaveBeenCalledWith(arrivesAt.getTime(), 'test-token');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: fixture.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('serializes duplicate delivery into one transfer and notification', async () => {
    const fixture = await canonicalDeploy({ arrivesAt: new Date(Date.now() - 1) });
    const first = job({ missionId: fixture.mission.id });
    const second = job({ missionId: fixture.mission.id });

    const outcomes = await Promise.all([processDeployArrivalJob(first), processDeployArrivalJob(second)]);

    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.destination.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
  });

  it('does not consume legacy fleet work or an unexpected dedicated-queue job name', async () => {
    const fixture = await canonicalDeploy({ arrivesAt: new Date(Date.now() - 1) });
    const wrongName = job({ missionId: fixture.mission.id }, 'fleet-arrival');

    expect(await processDeployArrivalJob(wrongName)).toBe('ignored');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: fixture.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});

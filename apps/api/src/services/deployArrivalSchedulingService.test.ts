import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma';
import { deployArrivalQueue } from '../lib/redis';
import { DeployLaunchInput, launchOwnedPlanetDeploy } from './deployLaunchService';
import {
  DEPLOY_ARRIVAL_JOB_NAME,
  deployArrivalJobId,
  scheduleDeployArrivalWakeup,
} from './deployArrivalSchedulingService';
import { invalidateUniverseConfigCache } from './gameConfig';

const NOW = new Date('2026-09-10T12:00:00.000Z');
let coordinate = 80;
let fixtureNumber = 0;
const queuedJobIds = new Set<string>();

beforeEach(() => {
  coordinate = 80;
  fixtureNumber = 0;
  invalidateUniverseConfigCache();
});

afterEach(async () => {
  for (const jobId of queuedJobIds) {
    const job = await deployArrivalQueue.getJob(jobId);
    if (job) await job.remove();
  }
  queuedJobIds.clear();
  jest.restoreAllMocks();
  invalidateUniverseConfigCache();
});

async function fixture() {
  fixtureNumber += 1;
  const user = await prisma.user.create({ data: {
    email: `deploy-scheduling-${fixtureNumber}@example.invalid`, username: `deploy-scheduling-${fixtureNumber}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Scheduling Origin ${fixtureNumber}`, galaxy: 3, system: 3, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 4_000, heliox: 5_000, aether: 200, lastProductionAt: new Date(),
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Scheduling Destination ${fixtureNumber}`, galaxy: 3, system: 3, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 700, heliox: 800, aether: 900, lastProductionAt: new Date(),
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: 5 } });
  return { user, origin, destination };
}

function launchInput(data: Awaited<ReturnType<typeof fixture>>): DeployLaunchInput {
  return { accountId: data.user.id, originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speedPercent: 100, ships: { scout: 2 } };
}

async function canonicalMission(data: Awaited<ReturnType<typeof fixture>>, arrivesAt = new Date(NOW.getTime() + 60_000)) {
  const accepted = await launchOwnedPlanetDeploy(launchInput(data));
  const automaticJob = await deployArrivalQueue.getJob(deployArrivalJobId(accepted.missionId));
  if (automaticJob) await automaticJob.remove();
  await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { arrivesAt } });
  return accepted.missionId;
}

describe('scheduleDeployArrivalWakeup', () => {
  it('schedules a future canonical deploy with deterministic ID, minimal payload, and persisted delay', async () => {
    const data = await fixture();
    const arrivesAt = new Date(NOW.getTime() + 90_000);
    const missionId = await canonicalMission(data, arrivesAt);
    const jobId = deployArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    await prisma.fleetMission.update({ where: { id: missionId }, data: { ships: { scout: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 } } });
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } }),
    ]);

    expect(await scheduleDeployArrivalWakeup(missionId, NOW)).toBe('scheduled');
    const job = await deployArrivalQueue.getJob(jobId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(DEPLOY_ARRIVAL_JOB_NAME);
    expect(job!.data).toEqual({ missionId });
    expect(job!.opts.jobId).toBe(jobId);
    expect(job!.opts.delay).toBe(90_000);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({ status: 'OUTBOUND', ships: before[0].ships, deployShips: { scout: 2 } });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({ alloy: before[1].alloy, heliox: before[1].heliox, aether: before[1].aether });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } })).toMatchObject({ alloy: before[2].alloy, heliox: before[2].heliox, aether: before[2].aether });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } })).toMatchObject({ count: before[3].count });
    expect(await prisma.ship.count({ where: { planetId: data.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
  });

  it('uses a zero-delay wake-up for due or overdue deploys without completing them', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data, new Date(NOW.getTime() - 1));
    const jobId = deployArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    expect(await scheduleDeployArrivalWakeup(missionId, NOW)).toBe('scheduled');
    expect((await deployArrivalQueue.getJob(jobId))!.opts.delay).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: data.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('retains one job across repeated and concurrent scheduling attempts', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const jobId = deployArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    const outcomes = await Promise.all([
      scheduleDeployArrivalWakeup(missionId, NOW),
      scheduleDeployArrivalWakeup(missionId, NOW),
      scheduleDeployArrivalWakeup(missionId, NOW),
    ]);
    expect(outcomes.every((outcome) => outcome === 'scheduled' || outcome === 'existing')).toBe(true);
    expect(await scheduleDeployArrivalWakeup(missionId, NOW)).toBe('existing');
    expect(await deployArrivalQueue.getJob(jobId)).toBeDefined();
    expect((await deployArrivalQueue.getJobs(['waiting', 'delayed'])).filter((job) => job.id === jobId)).toHaveLength(1);
  });

  it('does not enqueue missing, terminal, legacy/incomplete, malformed, or ownership-inconsistent rows', async () => {
    const add = jest.spyOn(deployArrivalQueue, 'add');
    expect(await scheduleDeployArrivalWakeup('missing-deploy-mission', NOW)).toBe('ineligible');

    const terminal = await fixture();
    const terminalMission = await canonicalMission(terminal);
    await prisma.fleetMission.update({ where: { id: terminalMission }, data: { status: 'COMPLETE' } });
    expect(await scheduleDeployArrivalWakeup(terminalMission, NOW)).toBe('ineligible');

    const incomplete = await fixture();
    const incompleteMission = await canonicalMission(incomplete);
    await prisma.fleetMission.update({ where: { id: incompleteMission }, data: { deployDurationSeconds: null } });
    expect(await scheduleDeployArrivalWakeup(incompleteMission, NOW)).toBe('ineligible');

    const malformed = await fixture();
    const malformedMission = await canonicalMission(malformed);
    await prisma.fleetMission.update({ where: { id: malformedMission }, data: { deployShips: { scout: 0 } } });
    expect(await scheduleDeployArrivalWakeup(malformedMission, NOW)).toBe('ineligible');

    const inconsistent = await fixture();
    const inconsistentMission = await canonicalMission(inconsistent);
    const other = await prisma.user.create({ data: { email: 'deploy-scheduling-other@example.invalid', username: 'deploy-scheduling-other', passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date() } });
    await prisma.planet.update({ where: { id: inconsistent.destination.id }, data: { ownerId: other.id } });
    expect(await scheduleDeployArrivalWakeup(inconsistentMission, NOW)).toBe('ineligible');

    const legacy = await fixture();
    const legacyMission = await prisma.fleetMission.create({ data: {
      originId: legacy.origin.id, targetId: legacy.destination.id, targetGalaxy: legacy.destination.galaxy, targetSystem: legacy.destination.system, targetSlot: legacy.destination.slot,
      missionType: 'DEPLOY', ships: { scout: 99 }, cargo: { alloy: 99 }, arrivesAt: new Date(NOW.getTime() + 1),
    } });
    // The canonical fixture launches above have each correctly dispatched
    // once before being made ineligible. The unavailable reads themselves
    // must not add another wake-up.
    const dispatchesBeforeIneligibleRead = add.mock.calls.length;
    expect(await scheduleDeployArrivalWakeup(legacyMission.id, NOW)).toBe('ineligible');
    expect(add).toHaveBeenCalledTimes(dispatchesBeforeIneligibleRead);
  });

  it('reports bounded Redis failure without changing PostgreSQL state', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } }),
    ]);
    jest.spyOn(deployArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await scheduleDeployArrivalWakeup(missionId, NOW)).toBe('failed');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({ status: before[0].status, deployShips: before[0].deployShips });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({ alloy: before[1].alloy, heliox: before[1].heliox, aether: before[1].aether });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } })).toMatchObject({ count: before[2].count });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('is dispatched only by internal launch, not completion, HTTP routes, or worker startup', async () => {
    const data = await fixture();
    const accepted = await launchOwnedPlanetDeploy(launchInput(data));
    const jobId = deployArrivalJobId(accepted.missionId);
    queuedJobIds.add(jobId);
    expect(accepted.schedulingOutcome).toBe('scheduled');
    expect(await deployArrivalQueue.getJob(jobId)).toMatchObject({
      name: DEPLOY_ARRIVAL_JOB_NAME,
      data: { missionId: accepted.missionId },
    });
    expect(readFileSync(resolve(__dirname, '../../../..', 'apps/api/src/services/deployLaunchService.ts'), 'utf8')).toContain('scheduleDeployArrivalWakeup');
    for (const source of [
      'apps/api/src/services/deployArrivalCompletionService.ts',
      'apps/api/src/routes/fleet.ts',
      'apps/worker/src/index.ts',
    ]) {
      expect(readFileSync(resolve(__dirname, '../../../..', source), 'utf8')).not.toContain('scheduleDeployArrivalWakeup');
    }
  });
});

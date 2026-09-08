import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma';
import { colonizationArrivalQueue } from '../lib/redis';
import { launchCanonicalColonization } from './colonizationLaunchService';
import {
  COLONIZATION_ARRIVAL_JOB_NAME,
  colonizationArrivalJobId,
  scheduleColonizationArrivalWakeup,
} from './colonizationArrivalSchedulingService';
import { invalidateUniverseConfigCache } from './gameConfig';

const NOW = new Date('2026-09-12T12:00:00.000Z');
let nextSystem = 300;
const queuedJobIds = new Set<string>();

beforeEach(() => {
  nextSystem = 300;
  invalidateUniverseConfigCache();
});

afterEach(async () => {
  for (const jobId of queuedJobIds) {
    const job = await colonizationArrivalQueue.getJob(jobId);
    if (job) await job.remove();
  }
  queuedJobIds.clear();
  jest.restoreAllMocks();
  invalidateUniverseConfigCache();
});

async function fixture() {
  const owner = await prisma.user.create({
    data: {
      email: `colonization-scheduling-${nextSystem}@example.invalid`,
      username: `colonization-scheduling-${nextSystem}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const origin = await prisma.planet.create({
    data: {
      ownerId: owner.id,
      name: 'Colonization scheduling origin',
      galaxy: 11,
      system: nextSystem++,
      slot: 1,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 5_000,
      heliox: 5_000,
      aether: 1_000,
      lastProductionAt: new Date(),
    },
  });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'colonyShip', count: 1 } });
  return { owner, origin };
}

async function canonicalMission(
  data: Awaited<ReturnType<typeof fixture>>,
  times: { departedAt: Date; arrivesAt: Date; durationSeconds: number } = {
    departedAt: NOW,
    arrivesAt: new Date(NOW.getTime() + 90_000),
    durationSeconds: 90,
  },
) {
  const accepted = await launchCanonicalColonization({ accountId: data.owner.id, originPlanetId: data.origin.id, targetSlot: 4 });
  const automatic = await colonizationArrivalQueue.getJob(colonizationArrivalJobId(accepted.missionId));
  if (automatic) await automatic.remove();
  await prisma.fleetMission.update({
    where: { id: accepted.missionId },
    data: {
      departedAt: times.departedAt,
      arrivesAt: times.arrivesAt,
      colonizationDurationSeconds: times.durationSeconds,
    },
  });
  return accepted.missionId;
}

describe('scheduleColonizationArrivalWakeup', () => {
  it('schedules a future canonical colonisation with the exact isolated queue contract and no state mutation', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const jobId = colonizationArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    await prisma.fleetMission.update({ where: { id: missionId }, data: { ships: { colonyShip: 99 }, cargo: { heliox: 99 } } });
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } }),
    ]);

    expect(await scheduleColonizationArrivalWakeup(missionId, NOW)).toBe('scheduled');
    const job = await colonizationArrivalQueue.getJob(jobId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(COLONIZATION_ARRIVAL_JOB_NAME);
    expect(job!.data).toEqual({ missionId });
    expect(job!.opts.jobId).toBe(jobId);
    expect(job!.opts.delay).toBe(90_000);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({
      status: 'OUTBOUND', ships: before[0].ships, colonizationShips: { colonyShip: 1 },
    });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({
      alloy: before[1].alloy, heliox: before[1].heliox, aether: before[1].aether,
    });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: before[2].count });
    expect(await prisma.planet.count({ where: { ownerId: data.owner.id } })).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
  });

  it('uses zero delay for a due canonical colonisation without completing it', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data, {
      departedAt: new Date(NOW.getTime() - 60_000),
      arrivesAt: NOW,
      durationSeconds: 60,
    });
    const jobId = colonizationArrivalJobId(missionId);
    queuedJobIds.add(jobId);

    expect(await scheduleColonizationArrivalWakeup(missionId, NOW)).toBe('scheduled');
    expect((await colonizationArrivalQueue.getJob(jobId))!.opts.delay).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.planet.count({ where: { ownerId: data.owner.id } })).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('retains one deterministic job across repeated and concurrent scheduling attempts', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const jobId = colonizationArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    const outcomes = await Promise.all([
      scheduleColonizationArrivalWakeup(missionId, NOW),
      scheduleColonizationArrivalWakeup(missionId, NOW),
      scheduleColonizationArrivalWakeup(missionId, NOW),
    ]);

    expect(outcomes.every((outcome) => outcome === 'scheduled' || outcome === 'existing')).toBe(true);
    expect(await scheduleColonizationArrivalWakeup(missionId, NOW)).toBe('existing');
    expect(await colonizationArrivalQueue.getJob(jobId)).toBeDefined();
    expect((await colonizationArrivalQueue.getJobs(['waiting', 'delayed'])).filter((job) => job.id === jobId)).toHaveLength(1);
  });

  it('retains an already-terminal deterministic job without replacing it', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const jobId = colonizationArrivalJobId(missionId);
    const getJob = jest.spyOn(colonizationArrivalQueue, 'getJob').mockResolvedValueOnce({
      getState: async () => 'completed',
    } as never);
    const add = jest.spyOn(colonizationArrivalQueue, 'add');

    expect(await scheduleColonizationArrivalWakeup(missionId, NOW)).toBe('retained-terminal');
    expect(add).not.toHaveBeenCalled();
    getJob.mockRestore();
  });

  it('does not schedule terminal, malformed, legacy, or recalled rows', async () => {
    const add = jest.spyOn(colonizationArrivalQueue, 'add');
    expect(await scheduleColonizationArrivalWakeup('missing-colonization-mission', NOW)).toBe('ineligible');

    const terminal = await fixture();
    const terminalMission = await canonicalMission(terminal);
    await prisma.fleetMission.update({ where: { id: terminalMission }, data: { status: 'COMPLETE', resultSummary: { colonizationOutcome: 'TARGET_OCCUPIED' } } });
    expect(await scheduleColonizationArrivalWakeup(terminalMission, NOW)).toBe('ineligible');

    const recalled = await fixture();
    const recalledMission = await canonicalMission(recalled);
    await prisma.fleetMission.update({ where: { id: recalledMission }, data: { status: 'RECALLED' } });
    expect(await scheduleColonizationArrivalWakeup(recalledMission, NOW)).toBe('ineligible');

    const malformed = await fixture();
    const malformedMission = await canonicalMission(malformed);
    await prisma.fleetMission.update({ where: { id: malformedMission }, data: { colonizationCharacteristics: { planetType: 'TEMPERATE' } } });
    expect(await scheduleColonizationArrivalWakeup(malformedMission, NOW)).toBe('ineligible');

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
        arrivesAt: new Date(NOW.getTime() + 1),
      },
    });
    const dispatchesBeforeIneligibleRead = add.mock.calls.length;
    expect(await scheduleColonizationArrivalWakeup(legacyMission.id, NOW)).toBe('ineligible');
    expect(add).toHaveBeenCalledTimes(dispatchesBeforeIneligibleRead);
  });

  it('reports Redis failure without changing committed PostgreSQL state', async () => {
    const data = await fixture();
    const missionId = await canonicalMission(data);
    const before = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } }),
    ]);
    jest.spyOn(colonizationArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));

    expect(await scheduleColonizationArrivalWakeup(missionId, NOW)).toBe('failed');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({
      status: before[0].status, colonizationShips: before[0].colonizationShips,
    });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({
      alloy: before[1].alloy, heliox: before[1].heliox, aether: before[1].aether,
    });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: before[2].count });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('dispatches only after launch commits and preserves acceptance when dispatch fails', async () => {
    const committed = await fixture();
    const add = jest.spyOn(colonizationArrivalQueue, 'add').mockImplementation(async () => {
      const mission = await prisma.fleetMission.findFirstOrThrow({ where: { originId: committed.origin.id } });
      const [origin, ships] = await Promise.all([
        prisma.planet.findUniqueOrThrow({ where: { id: committed.origin.id } }),
        prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: committed.origin.id, key: 'colonyShip' } } }),
      ]);
      expect(mission).toMatchObject({ missionType: 'COLONIZE', status: 'OUTBOUND' });
      expect(ships.count).toBe(0);
      expect(origin.heliox).toBeLessThan(5_000);
      return {} as never;
    });
    const accepted = await launchCanonicalColonization({ accountId: committed.owner.id, originPlanetId: committed.origin.id, targetSlot: 4 });
    expect(accepted.schedulingOutcome).toBe('scheduled');
    add.mockRestore();

    const failed = await fixture();
    jest.spyOn(colonizationArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    const failedAccepted = await launchCanonicalColonization({ accountId: failed.owner.id, originPlanetId: failed.origin.id, targetSlot: 4 });
    const [mission, ships, origin] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: failedAccepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: failed.origin.id, key: 'colonyShip' } } }),
      prisma.planet.findUniqueOrThrow({ where: { id: failed.origin.id } }),
    ]);
    expect(failedAccepted.schedulingOutcome).toBe('failed');
    expect(mission).toMatchObject({ status: 'OUTBOUND', colonizationShips: { colonyShip: 1 } });
    expect(ships.count).toBe(0);
    expect(origin.heliox).toBe(5_000 - mission.colonizationFuelHeliox!);
  });

  it('is not wired into a worker, public route, or the legacy fleet queue', () => {
    const root = resolve(__dirname, '../../../..');
    expect(readFileSync(resolve(root, 'apps/api/src/services/colonizationArrivalSchedulingService.ts'), 'utf8')).not.toContain('fleetQueue');
    for (const source of [
      'apps/worker/src/index.ts',
      'apps/worker/src/queues.ts',
      'apps/api/src/routes/fleet.ts',
    ]) {
      expect(readFileSync(resolve(root, source), 'utf8')).not.toContain('colonization-arrival-queue');
    }
  });
});

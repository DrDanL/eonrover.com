import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma';
import { espionageProbeArrivalQueue, fleetQueue } from '../lib/redis';
import { settleCanonicalEspionageProbe } from './espionageProbeCompletionService';
import { invalidateUniverseConfigCache } from './gameConfig';
import {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  espionageProbeArrivalJobId,
  espionageProbeReturnJobId,
  scheduleEspionageProbeArrivalWakeup,
  scheduleEspionageProbeReturnWakeup,
} from './espionageProbeArrivalSchedulingService';
import { launchCanonicalEspionageProbe } from './espionageProbeLaunchService';

const NOW = new Date('2026-09-12T12:00:00.000Z');
let fixtureNumber = 0;
const queuedJobIds = new Set<string>();

beforeEach(() => {
  fixtureNumber = 0;
  invalidateUniverseConfigCache();
});
afterEach(async () => {
  for (const jobId of queuedJobIds) {
    const job = await espionageProbeArrivalQueue.getJob(jobId);
    if (job) await job.remove();
  }
  queuedJobIds.clear();
  jest.restoreAllMocks();
  invalidateUniverseConfigCache();
});

async function fixture() {
  fixtureNumber += 1;
  const attacker = await prisma.user.create({ data: {
    email: `probe-scheduling-attacker-${fixtureNumber}@example.invalid`, username: `probe-scheduling-attacker-${fixtureNumber}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const defender = await prisma.user.create({ data: {
    email: `probe-scheduling-defender-${fixtureNumber}@example.invalid`, username: `probe-scheduling-defender-${fixtureNumber}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: attacker.id, name: 'Probe scheduling origin', galaxy: 1, system: 100 + fixtureNumber * 2, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 5_000, aether: 1_000, lastProductionAt: NOW,
  } });
  const target = await prisma.planet.create({ data: {
    ownerId: defender.id, name: 'Probe scheduling target', galaxy: 1, system: 101 + fixtureNumber * 2, slot: 2,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  await prisma.$transaction([
    prisma.research.create({ data: { userId: attacker.id, key: 'espionageTech', level: 1 } }),
    prisma.ship.create({ data: { planetId: origin.id, key: 'probe', count: 1 } }),
  ]);
  return { attacker, defender, origin, target };
}

async function outboundMission(data: Awaited<ReturnType<typeof fixture>>, dueOffset = 90_000) {
  const accepted = await launchCanonicalEspionageProbe({
    userId: data.attacker.id,
    originPlanetId: data.origin.id,
    target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot },
  });
  const automaticJobId = espionageProbeArrivalJobId(accepted.missionId);
  const automatic = await espionageProbeArrivalQueue.getJob(automaticJobId);
  if (automatic) await automatic.remove();
  const arrivesAt = new Date(NOW.getTime() + dueOffset);
  const departedAt = new Date(arrivesAt.getTime() - accepted.outboundDurationSeconds * 1_000);
  const returnsAt = new Date(arrivesAt.getTime() + accepted.returnDurationSeconds * 1_000);
  await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { departedAt, arrivesAt, returnsAt } });
  return { ...accepted, departedAt, arrivesAt, returnsAt };
}

async function returningMission(data: Awaited<ReturnType<typeof fixture>>, dueOffset = 90_000) {
  const accepted = await outboundMission(data);
  const returnsAt = new Date(NOW.getTime() + dueOffset);
  const arrivesAt = new Date(returnsAt.getTime() - accepted.returnDurationSeconds * 1_000);
  const departedAt = new Date(arrivesAt.getTime() - accepted.outboundDurationSeconds * 1_000);
  await prisma.fleetMission.update({
    where: { id: accepted.missionId },
    data: { departedAt, arrivesAt, returnsAt, status: 'RETURNING', espionageProbePhase: 'RETURNING' },
  });
  return { ...accepted, departedAt, arrivesAt, returnsAt };
}

describe('canonical Espionage Probe wake-up scheduling', () => {
  it('schedules future and due arrivals with the exact deterministic contract', async () => {
    const future = await outboundMission(await fixture(), 90_000);
    const futureJobId = espionageProbeArrivalJobId(future.missionId);
    queuedJobIds.add(futureJobId);
    expect(await scheduleEspionageProbeArrivalWakeup(future.missionId, NOW)).toBe('scheduled');
    const futureJob = await espionageProbeArrivalQueue.getJob(futureJobId);
    expect(futureJob).toMatchObject({ name: ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, data: { missionId: future.missionId } });
    expect(futureJob!.opts).toMatchObject({ jobId: futureJobId, delay: 90_000, removeOnComplete: true, attempts: 3 });

    const due = await outboundMission(await fixture(), 0);
    const dueJobId = espionageProbeArrivalJobId(due.missionId);
    queuedJobIds.add(dueJobId);
    expect(await scheduleEspionageProbeArrivalWakeup(due.missionId, NOW)).toBe('scheduled');
    expect((await espionageProbeArrivalQueue.getJob(dueJobId))!.opts.delay).toBe(0);
  });

  it('schedules future and due returns with the exact deterministic contract', async () => {
    const future = await returningMission(await fixture(), 60_000);
    const futureJobId = espionageProbeReturnJobId(future.missionId);
    queuedJobIds.add(futureJobId);
    expect(await scheduleEspionageProbeReturnWakeup(future.missionId, NOW)).toBe('scheduled');
    const futureJob = await espionageProbeArrivalQueue.getJob(futureJobId);
    expect(futureJob).toMatchObject({ name: ESPIONAGE_PROBE_RETURN_JOB_NAME, data: { missionId: future.missionId } });
    expect(futureJob!.opts).toMatchObject({ jobId: futureJobId, delay: 60_000, removeOnComplete: true, attempts: 3 });

    const due = await returningMission(await fixture(), -1);
    const dueJobId = espionageProbeReturnJobId(due.missionId);
    queuedJobIds.add(dueJobId);
    expect(await scheduleEspionageProbeReturnWakeup(due.missionId, NOW)).toBe('scheduled');
    expect((await espionageProbeArrivalQueue.getJob(dueJobId))!.opts.delay).toBe(0);
  });

  it('retains one live deterministic job and never replaces terminal Redis jobs', async () => {
    const accepted = await outboundMission(await fixture());
    const jobId = espionageProbeArrivalJobId(accepted.missionId);
    queuedJobIds.add(jobId);
    const outcomes = await Promise.all([
      scheduleEspionageProbeArrivalWakeup(accepted.missionId, NOW),
      scheduleEspionageProbeArrivalWakeup(accepted.missionId, NOW),
      scheduleEspionageProbeArrivalWakeup(accepted.missionId, NOW),
    ]);
    expect(outcomes.every((outcome) => outcome === 'scheduled' || outcome === 'existing')).toBe(true);
    expect((await espionageProbeArrivalQueue.getJobs(['waiting', 'delayed'])).filter((job) => job.id === jobId)).toHaveLength(1);

    const terminal = await outboundMission(await fixture());
    const getJob = jest.spyOn(espionageProbeArrivalQueue, 'getJob').mockResolvedValueOnce({ getState: async () => 'completed' } as never);
    const add = jest.spyOn(espionageProbeArrivalQueue, 'add');
    expect(await scheduleEspionageProbeArrivalWakeup(terminal.missionId, NOW)).toBe('retained-terminal');
    expect(add).not.toHaveBeenCalled();
    getJob.mockRestore();
  });

  it('contains terminal, malformed, legacy, and forged legacy data without PostgreSQL mutation', async () => {
    const add = jest.spyOn(espionageProbeArrivalQueue, 'add');
    const terminal = await outboundMission(await fixture());
    await prisma.fleetMission.update({ where: { id: terminal.missionId }, data: { status: 'COMPLETE', espionageProbePhase: 'COMPLETE' } });
    expect(await scheduleEspionageProbeArrivalWakeup(terminal.missionId, NOW)).toBe('ineligible');

    const malformed = await outboundMission(await fixture());
    await prisma.fleetMission.update({ where: { id: malformed.missionId }, data: { espionageProbeShips: { probe: 2 } } });
    const malformedBefore = await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.missionId } });
    expect(await scheduleEspionageProbeArrivalWakeup(malformed.missionId, NOW)).toBe('ineligible');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.missionId } })).toMatchObject({ espionageProbeShips: malformedBefore.espionageProbeShips });

    const legacyData = await fixture();
    const legacy = await prisma.fleetMission.create({ data: {
      originId: legacyData.origin.id, targetId: legacyData.target.id,
      targetGalaxy: legacyData.target.galaxy, targetSystem: legacyData.target.system, targetSlot: legacyData.target.slot,
      missionType: 'ESPIONAGE', ships: { probe: 99 }, cargo: { alloy: 999 }, speedPercent: 1,
      arrivesAt: new Date(NOW.getTime() + 1), status: 'OUTBOUND', jobId: 'forged-legacy-job',
    } });
    const callsBeforeLegacy = add.mock.calls.length;
    expect(await scheduleEspionageProbeArrivalWakeup(legacy.id, NOW)).toBe('ineligible');
    expect(add).toHaveBeenCalledTimes(callsBeforeLegacy);
    expect(await prisma.notification.count()).toBe(0);

    const forged = await outboundMission(await fixture());
    await prisma.fleetMission.update({ where: { id: forged.missionId }, data: { ships: { probe: 99 }, cargo: { alloy: 999 }, jobId: 'forged-payload' } });
    const forgedJobId = espionageProbeArrivalJobId(forged.missionId);
    queuedJobIds.add(forgedJobId);
    expect(await scheduleEspionageProbeArrivalWakeup(forged.missionId, NOW)).toBe('scheduled');
    expect(await espionageProbeArrivalQueue.getJob(forgedJobId)).toMatchObject({ data: { missionId: forged.missionId } });
  });

  it('dispatches arrival only after launch commits and preserves its reservation when Redis fails', async () => {
    const committed = await fixture();
    const add = jest.spyOn(espionageProbeArrivalQueue, 'add').mockImplementation(async () => {
      const [mission, origin, probes] = await Promise.all([
        prisma.fleetMission.findFirstOrThrow({ where: { espionageOriginPlanetId: committed.origin.id } }),
        prisma.planet.findUniqueOrThrow({ where: { id: committed.origin.id } }),
        prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: committed.origin.id, key: 'probe' } } }),
      ]);
      expect(mission).toMatchObject({ missionType: 'ESPIONAGE', espionageProbePhase: 'OUTBOUND' });
      expect(probes.count).toBe(0);
      expect(origin.heliox).toBeLessThan(5_000);
      return {} as never;
    });
    const accepted = await launchCanonicalEspionageProbe({
      userId: committed.attacker.id, originPlanetId: committed.origin.id,
      target: { galaxy: committed.target.galaxy, system: committed.target.system, slot: committed.target.slot },
    });
    expect(accepted.schedulingOutcome).toBe('scheduled');
    add.mockRestore();

    const failed = await fixture();
    jest.spyOn(espionageProbeArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    const failedAccepted = await launchCanonicalEspionageProbe({
      userId: failed.attacker.id, originPlanetId: failed.origin.id,
      target: { galaxy: failed.target.galaxy, system: failed.target.system, slot: failed.target.slot },
    });
    const [mission, probe] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: failedAccepted.missionId } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: failed.origin.id, key: 'probe' } } }),
    ]);
    expect(failedAccepted.schedulingOutcome).toBe('failed');
    expect(mission).toMatchObject({ espionageProbePhase: 'OUTBOUND', espionageProbeShips: { probe: 1 } });
    expect(probe.count).toBe(0);
  });

  it('dispatches return only after a due arrival commits and preserves return state when Redis fails', async () => {
    const deliveredData = await fixture();
    const delivered = await outboundMission(deliveredData, 0);
    const add = jest.spyOn(espionageProbeArrivalQueue, 'add').mockImplementation(async (name, data) => {
      const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: delivered.missionId } });
      expect(name).toBe(ESPIONAGE_PROBE_RETURN_JOB_NAME);
      expect(data).toEqual({ missionId: delivered.missionId });
      expect(mission).toMatchObject({ status: 'RETURNING', espionageProbePhase: 'RETURNING' });
      return {} as never;
    });
    expect(await settleCanonicalEspionageProbe(delivered.missionId, NOW)).toBe('arrived');
    add.mockRestore();

    const failedData = await fixture();
    const failed = await outboundMission(failedData, 0);
    jest.spyOn(espionageProbeArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await settleCanonicalEspionageProbe(failed.missionId, NOW)).toBe('arrived');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: failed.missionId } })).toMatchObject({ status: 'RETURNING', espionageProbePhase: 'RETURNING' });
    expect(await prisma.espionageProbeReport.count({ where: { missionId: failed.missionId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: failedData.attacker.id, type: 'ESPIONAGE_REPORT_READY' } })).toBe(1);
  });

  it('keeps the Probe scheduler isolated from the legacy Fleet queue', () => {
    const root = resolve(__dirname, '../../../..');
    const workerEntry = readFileSync(resolve(root, 'apps/worker/src/index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('espionage-probe-arrival-queue', processEspionageProbeArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
    expect(fleetQueue.name).toBe('fleet-queue');
    expect(espionageProbeArrivalQueue.name).toBe('espionage-probe-arrival-queue');
  });
});

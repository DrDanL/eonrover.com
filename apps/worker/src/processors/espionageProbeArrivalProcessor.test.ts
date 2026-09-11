import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import { prisma } from '../prisma';
import { espionageProbeArrivalQueue } from '../queues';
import {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  processEspionageProbeArrivalJob,
} from './espionageProbeArrivalProcessor';

let sequence = 0;
const queuedJobIds = new Set<string>();

afterEach(async () => {
  for (const id of queuedJobIds) {
    const queued = await espionageProbeArrivalQueue.getJob(id);
    if (queued) await queued.remove();
  }
  queuedJobIds.clear();
});

async function canonicalProbe(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
  withOriginProbe?: boolean;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: {
    email: `probe-worker-attacker-${sequence}@example.invalid`, username: `probe-worker-attacker-${sequence}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const defender = await prisma.user.create({ data: {
    email: `probe-worker-defender-${sequence}@example.invalid`, username: `probe-worker-defender-${sequence}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: attacker.id, name: 'Probe worker origin', galaxy: 1, system: 100 + sequence * 2, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(Date.now() - 60_000),
  } });
  const target = await prisma.planet.create({ data: {
    ownerId: defender.id, name: 'Probe worker target', galaxy: 1, system: 101 + sequence * 2, slot: 2,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(Date.now() - 60_000),
  } });
  if (options.withOriginProbe) {
    await prisma.ship.create({ data: { planetId: origin.id, key: 'probe', count: 1 } });
  }
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = phase === 'RETURNING'
    ? options.returnsAt ?? new Date(Date.now() - 1_000)
    : options.returnsAt;
  const arrivesAt = phase === 'RETURNING'
    ? new Date(returnsAt!.getTime() - 60_000)
    : options.arrivesAt ?? new Date(Date.now() - 1_000);
  const canonicalReturnsAt = returnsAt ?? new Date(arrivesAt.getTime() + 60_000);
  const departedAt = new Date(arrivesAt.getTime() - 60_000);
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id,
    targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ESPIONAGE', ships: { probe: 999 }, cargo: { alloy: 999 }, speedPercent: 100,
    departedAt, arrivesAt, returnsAt: canonicalReturnsAt,
    status: options.cancelled ? 'RECALLED' : phase,
    espionageOriginPlanetId: origin.id, espionageTargetPlanetId: target.id,
    espionageOriginAccountId: attacker.id, espionageTargetAccountId: defender.id,
    espionageProbeShips: options.malformed ? { probe: 2 } : { probe: 1 },
    espionageOutboundFuelHeliox: 1, espionageReturnFuelHeliox: 1,
    espionageOutboundDurationSeconds: 60, espionageReturnDurationSeconds: 60,
    espionageProbePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.espionageProbeReport.create({ data: {
      missionId: mission.id, attackerId: attacker.id, targetPlanetId: target.id, createdAt: arrivesAt,
      tier: 'IDENTITY', disclosureSnapshot: { tier: 'IDENTITY', target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot }, planetName: target.name, planetType: 'temperate', ownerUsername: defender.username } },
    } });
  }
  return { attacker, defender, origin, target, mission, arrivesAt, returnsAt };
}

function job(data: unknown, name = ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, id?: string) {
  return {
    id, name, data, token: 'test-token', moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

describe('processEspionageProbeArrivalJob', () => {
  it('settles a due outbound mission once, creates the report and notifications, and schedules only its return wake-up', async () => {
    const fixture = await canonicalProbe();
    const queued = job({
      missionId: fixture.mission.id, accountId: 'forged', originId: 'forged', targetId: 'forged',
      ships: { probe: 99 }, fuel: 0, arrivesAt: new Date(0), report: { leaked: true }, phase: 'COMPLETE',
    }, ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, `espionage-probe-arrival-${fixture.mission.id}`);

    expect(await processEspionageProbeArrivalJob(queued)).toBe('arrived');
    const returnJobId = `espionage-probe-return-${fixture.mission.id}`;
    queuedJobIds.add(returnJobId);
    const [mission, report, notifications, returnJob] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } }),
      prisma.espionageProbeReport.findUniqueOrThrow({ where: { missionId: fixture.mission.id } }),
      prisma.notification.findMany({ where: { userId: { in: [fixture.attacker.id, fixture.defender.id] } } }),
      espionageProbeArrivalQueue.getJob(returnJobId),
    ]);
    expect(mission).toMatchObject({ status: 'RETURNING', espionageProbePhase: 'RETURNING', espionageProbeShips: { probe: 1 } });
    expect(report).toMatchObject({ attackerId: fixture.attacker.id, targetPlanetId: fixture.target.id });
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: fixture.attacker.id, type: 'ESPIONAGE_REPORT_READY' }),
      expect.objectContaining({ userId: fixture.defender.id, type: 'ESPIONAGE_DETECTED' }),
    ]));
    expect(notifications).toHaveLength(2);
    expect(returnJob).toMatchObject({ name: ESPIONAGE_PROBE_RETURN_JOB_NAME, data: { missionId: fixture.mission.id } });
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  it('settles a due return once and restores a missing Probe inventory row through the completion core', async () => {
    const fixture = await canonicalProbe({ phase: 'RETURNING', returnsAt: new Date(Date.now() - 1_000) });
    const queued = job({ missionId: fixture.mission.id, targetId: 'forged', ships: { probe: 999 } }, ESPIONAGE_PROBE_RETURN_JOB_NAME, `espionage-probe-return-${fixture.mission.id}`);

    expect(await processEspionageProbeArrivalJob(queued)).toBe('returned');
    expect(await processEspionageProbeArrivalJob(queued)).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE', espionageProbePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'probe' } } })).toMatchObject({ count: 1 });
    expect(await prisma.espionageProbeReport.count({ where: { missionId: fixture.mission.id } })).toBe(1);
  });

  it('moves early outbound and returning jobs to their persisted due times without side effects', async () => {
    const arrivalDue = new Date(Date.now() + 60_000);
    const outbound = await canonicalProbe({ arrivesAt: arrivalDue, returnsAt: new Date(arrivalDue.getTime() + 60_000) });
    const outboundJob = job({ missionId: outbound.mission.id, arrivesAt: new Date(0) }, ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, `espionage-probe-arrival-${outbound.mission.id}`);
    expect(await processEspionageProbeArrivalJob(outboundJob)).toBe('early');
    expect(outboundJob.moveToDelayed).toHaveBeenCalledWith(arrivalDue.getTime(), 'test-token');
    expect(await prisma.espionageProbeReport.count({ where: { missionId: outbound.mission.id } })).toBe(0);

    const returnDue = new Date(Date.now() + 60_000);
    const returning = await canonicalProbe({ phase: 'RETURNING', arrivesAt: new Date(Date.now() - 60_000), returnsAt: returnDue });
    const returnJob = job({ missionId: returning.mission.id, returnsAt: new Date(0) }, ESPIONAGE_PROBE_RETURN_JOB_NAME, `espionage-probe-return-${returning.mission.id}`);
    expect(await processEspionageProbeArrivalJob(returnJob)).toBe('early');
    expect(returnJob.moveToDelayed).toHaveBeenCalledWith(returnDue.getTime(), 'test-token');
    expect(await prisma.ship.count({ where: { planetId: returning.origin.id, key: 'probe' } })).toBe(0);
  });

  it('keeps duplicate delivery exactly once and ignores wrong queue hygiene records', async () => {
    const fixture = await canonicalProbe();
    const first = job({ missionId: fixture.mission.id }, ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, `espionage-probe-arrival-${fixture.mission.id}`);
    const second = job({ missionId: fixture.mission.id }, ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, `espionage-probe-arrival-${fixture.mission.id}`);
    const results = await Promise.all([processEspionageProbeArrivalJob(first), processEspionageProbeArrivalJob(second)]);
    expect(results.filter((result) => result === 'arrived')).toHaveLength(1);
    expect(await prisma.espionageProbeReport.count({ where: { missionId: fixture.mission.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [fixture.attacker.id, fixture.defender.id] } } })).toBe(2);

    const wrongName = await canonicalProbe();
    expect(await processEspionageProbeArrivalJob(job({ missionId: wrongName.mission.id }, 'forged-probe-job', `espionage-probe-arrival-${wrongName.mission.id}`))).toBe('ignored');
    const wrongId = await canonicalProbe();
    expect(await processEspionageProbeArrivalJob(job({ missionId: wrongId.mission.id }, ESPIONAGE_PROBE_RETURN_JOB_NAME, `espionage-probe-return-${wrongId.mission.id}`))).toBe('ignored');
    expect(await prisma.espionageProbeReport.count({ where: { missionId: { in: [wrongName.mission.id, wrongId.mission.id] } } })).toBe(0);
  });

  it('keeps missing, legacy, malformed, cancelled, and terminal rows harmless', async () => {
    const terminal = await canonicalProbe({ phase: 'COMPLETE' });
    const malformed = await canonicalProbe({ malformed: true, arrivesAt: new Date(Date.now() + 60_000) });
    const cancelled = await canonicalProbe({ cancelled: true });
    const legacy = await prisma.fleetMission.create({ data: {
      originId: terminal.origin.id, targetId: terminal.target.id,
      targetGalaxy: terminal.target.galaxy, targetSystem: terminal.target.system, targetSlot: terminal.target.slot,
      missionType: 'ESPIONAGE', ships: { probe: 99 }, cargo: { alloy: 99 }, speedPercent: 100,
      arrivesAt: new Date(Date.now() - 1), status: 'OUTBOUND', jobId: 'legacy-probe-job',
    } });
    expect(await processEspionageProbeArrivalJob(job({ missionId: 'missing' }))).toBe('noop');
    expect(await processEspionageProbeArrivalJob(job({ missionId: terminal.mission.id }))).toBe('noop');
    const malformedJob = job({ missionId: malformed.mission.id });
    expect(await processEspionageProbeArrivalJob(malformedJob)).toBe('noop');
    expect(malformedJob.moveToDelayed).not.toHaveBeenCalled();
    expect(await processEspionageProbeArrivalJob(job({ missionId: cancelled.mission.id }))).toBe('noop');
    expect(await processEspionageProbeArrivalJob(job({ missionId: legacy.id }))).toBe('noop');
    expect(await prisma.notification.count()).toBe(0);
  });

  it('registers only the dedicated Probe consumer and leaves the legacy Fleet queue dormant', () => {
    const workerEntry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('espionage-probe-arrival-queue', processEspionageProbeArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
  });
});

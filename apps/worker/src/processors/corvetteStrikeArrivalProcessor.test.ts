import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import { CORVETTE_STRIKE_RESOLVER_VERSION } from '@eonrover/shared';
import { prisma } from '../prisma';
import { corvetteStrikeArrivalQueue } from '../queues';
import {
  CORVETTE_STRIKE_ARRIVAL_JOB_NAME,
  CORVETTE_STRIKE_RETURN_JOB_NAME,
  processCorvetteStrikeArrivalJob,
} from './corvetteStrikeArrivalProcessor';

let sequence = 0;
const queueJobs = new Set<string>();

afterEach(async () => {
  for (const id of queueJobs) {
    const queued = await corvetteStrikeArrivalQueue.getJob(id);
    if (queued) await queued.remove();
  }
  queueJobs.clear();
});

async function canonicalStrike(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: { email: `strike-worker-a-${sequence}@example.invalid`, username: `strike-worker-a-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const defender = await prisma.user.create({ data: { email: `strike-worker-d-${sequence}@example.invalid`, username: `strike-worker-d-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const origin = await prisma.planet.create({ data: { ownerId: attacker.id, name: 'Origin', galaxy: 1, system: 400 + sequence * 2, slot: 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } });
  const target = await prisma.planet.create({ data: { ownerId: defender.id, name: 'Target', galaxy: 1, system: 401 + sequence * 2, slot: 2, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } });
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = options.returnsAt ?? (phase === 'RETURNING' ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000));
  const arrivesAt = options.arrivesAt ?? (phase === 'RETURNING' ? new Date(returnsAt.getTime() - 60_000) : new Date(Date.now() - 1_000));
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ATTACK', ships: { legacy: 'ignored' }, cargo: { forged: true }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt,
    status: options.cancelled ? 'RECALLED' : phase,
    corvetteStrikeOriginPlanetId: origin.id, corvetteStrikeTargetPlanetId: target.id,
    corvetteStrikeAttackerId: attacker.id, corvetteStrikeDefenderId: defender.id,
    corvetteStrikeShips: options.malformed ? { corvette: 0 } : { corvette: 2 },
    corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1,
    corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60,
    corvetteStrikeResolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, corvetteStrikeResolverSeed: 'f'.repeat(64),
    corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.corvetteStrikeReport.create({ data: { missionId: mission.id, attackerId: attacker.id, defenderId: defender.id, createdAt: arrivesAt, resolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION, resultSnapshot: { survivors: { attacker: { corvette: 2 } } } } });
  }
  return { attacker, defender, origin, target, mission, arrivesAt, returnsAt };
}

function job(data: unknown, name = CORVETTE_STRIKE_ARRIVAL_JOB_NAME, id?: string) {
  return { id, name, data, token: 'test-token', moveToDelayed: jest.fn().mockResolvedValue(undefined) } as unknown as Job;
}

describe('processCorvetteStrikeArrivalJob', () => {
  it('settles a due arrival through the authoritative core once and ignores forged payload fields', async () => {
    const data = await canonicalStrike();
    const queued = job({ missionId: data.mission.id, attacker: 'forged', defender: 'forged', origin: 'forged', target: 'forged', ships: { corvette: 99 }, fuel: 0, result: { forged: true } }, CORVETTE_STRIKE_ARRIVAL_JOB_NAME, `corvette-strike-arrival-${data.mission.id}`);
    expect(await processCorvetteStrikeArrivalJob(queued)).toBe('arrived');
    queueJobs.add(`corvette-strike-return-${data.mission.id}`);
    expect(await processCorvetteStrikeArrivalJob(queued)).toBe('ignored');
    const [mission, report, notices] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } }),
      prisma.corvetteStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } }),
      prisma.notification.findMany({ where: { userId: { in: [data.attacker.id, data.defender.id] } } }),
    ]);
    expect(mission).toMatchObject({ status: 'RETURNING', corvetteStrikePhase: 'RETURNING', corvetteStrikeShips: { corvette: 2 } });
    expect(report).toMatchObject({ attackerId: data.attacker.id, defenderId: data.defender.id, resolverVersion: CORVETTE_STRIKE_RESOLVER_VERSION });
    expect(notices).toHaveLength(2);
  });

  it('restores surviving Corvettes exactly once on a due return, creating missing inventory', async () => {
    const data = await canonicalStrike({ phase: 'RETURNING' });
    const queued = job({ missionId: data.mission.id, ships: { corvette: 999 } }, CORVETTE_STRIKE_RETURN_JOB_NAME, `corvette-strike-return-${data.mission.id}`);
    expect(await processCorvetteStrikeArrivalJob(queued)).toBe('returned');
    expect(await processCorvetteStrikeArrivalJob(queued)).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } })).toMatchObject({ status: 'COMPLETE', corvetteStrikePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: { in: [data.attacker.id, data.defender.id] } } })).toBe(0);
  });

  it('moves early arrival and return jobs to persisted deadlines without effects', async () => {
    const arrivalDue = new Date(Date.now() + 60_000);
    const outbound = await canonicalStrike({ arrivesAt: arrivalDue, returnsAt: new Date(arrivalDue.getTime() + 60_000) });
    const arrivalJob = job({ missionId: outbound.mission.id, arrivesAt: new Date(0) }, CORVETTE_STRIKE_ARRIVAL_JOB_NAME, `corvette-strike-arrival-${outbound.mission.id}`);
    expect(await processCorvetteStrikeArrivalJob(arrivalJob)).toBe('early');
    expect(arrivalJob.moveToDelayed).toHaveBeenCalledWith(arrivalDue.getTime(), 'test-token');
    expect(await prisma.corvetteStrikeReport.count({ where: { missionId: outbound.mission.id } })).toBe(0);
    const returnDue = new Date(Date.now() + 60_000);
    const returning = await canonicalStrike({ phase: 'RETURNING', returnsAt: returnDue });
    const returnJob = job({ missionId: returning.mission.id, returnsAt: new Date(0) }, CORVETTE_STRIKE_RETURN_JOB_NAME, `corvette-strike-return-${returning.mission.id}`);
    expect(await processCorvetteStrikeArrivalJob(returnJob)).toBe('early');
    expect(returnJob.moveToDelayed).toHaveBeenCalledWith(returnDue.getTime(), 'test-token');
    expect(await prisma.ship.count({ where: { planetId: returning.origin.id, key: 'corvette' } })).toBe(0);
  });

  it('leaves missing, malformed, legacy, cancelled, terminal, and wrong-hygiene jobs harmless', async () => {
    const malformed = await canonicalStrike({ malformed: true });
    const cancelled = await canonicalStrike({ cancelled: true });
    const terminal = await canonicalStrike({ phase: 'COMPLETE' });
    const legacy = await prisma.fleetMission.create({ data: { originId: terminal.origin.id, targetId: terminal.target.id, targetGalaxy: terminal.target.galaxy, targetSystem: terminal.target.system, targetSlot: terminal.target.slot, missionType: 'ATTACK', ships: { corvette: 99 }, cargo: {}, arrivesAt: new Date(Date.now() - 1), status: 'OUTBOUND' } });
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: 'missing' }))).toBe('noop');
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: malformed.mission.id }))).toBe('noop');
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: cancelled.mission.id }))).toBe('noop');
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: terminal.mission.id }))).toBe('noop');
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: legacy.id }))).toBe('noop');
    expect(await processCorvetteStrikeArrivalJob(job({ missionId: malformed.mission.id }, 'forged', `corvette-strike-arrival-${malformed.mission.id}`))).toBe('ignored');
    expect(await prisma.corvetteStrikeReport.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('registers only the dedicated strike queue and leaves fleet-queue dormant', () => {
    const workerEntry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('corvette-strike-arrival-queue', processCorvetteStrikeArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
  });
});

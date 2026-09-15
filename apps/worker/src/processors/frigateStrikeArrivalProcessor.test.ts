import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import {
  FRIGATE_STRIKE_RESOLVER_VERSION,
  frigateStrikeArrivalJobId,
  frigateStrikeReturnJobId,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { frigateStrikeArrivalQueue } from '../queues';
import {
  FRIGATE_STRIKE_ARRIVAL_JOB_NAME,
  FRIGATE_STRIKE_RETURN_JOB_NAME,
  processFrigateStrikeArrivalJob,
} from './frigateStrikeArrivalProcessor';

let sequence = 0;
const queueJobs = new Set<string>();

afterEach(async () => {
  for (const id of queueJobs) {
    const queued = await frigateStrikeArrivalQueue.getJob(id);
    if (queued) await queued.remove();
  }
  queueJobs.clear();
});

async function canonicalFrigateStrike(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
  cancelled?: boolean;
  defence?: 'flakTurret' | 'planetaryShield';
  survivors?: number;
} = {}) {
  sequence += 1;
  const attacker = await prisma.user.create({ data: { email: `frigate-worker-a-${sequence}@example.invalid`, username: `frigate-worker-a-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const defender = await prisma.user.create({ data: { email: `frigate-worker-d-${sequence}@example.invalid`, username: `frigate-worker-d-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: new Date() } });
  const origin = await prisma.planet.create({ data: { ownerId: attacker.id, name: 'Origin', galaxy: 1, system: 600 + sequence * 2, slot: 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } });
  const target = await prisma.planet.create({ data: { ownerId: defender.id, name: 'Target', galaxy: 1, system: 601 + sequence * 2, slot: 2, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: new Date() } });
  if (options.defence) await prisma.defence.create({ data: { planetId: target.id, key: options.defence, count: 1 } });
  const phase = options.phase ?? 'OUTBOUND';
  const returnsAt = options.returnsAt ?? (phase === 'RETURNING' ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000));
  const arrivesAt = options.arrivesAt ?? (phase === 'RETURNING' ? new Date(returnsAt.getTime() - 60_000) : new Date(Date.now() - 1_000));
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: target.id, targetGalaxy: target.galaxy, targetSystem: target.system, targetSlot: target.slot,
    missionType: 'ATTACK', ships: { legacy: 'ignored' }, cargo: { forged: true }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt,
    status: options.cancelled ? 'RECALLED' : phase,
    frigateStrikeOriginPlanetId: origin.id, frigateStrikeTargetPlanetId: target.id,
    frigateStrikeAttackerId: attacker.id, frigateStrikeDefenderId: defender.id,
    frigateStrikeShips: options.malformed ? { frigate: 0 } : { frigate: 2 },
    frigateStrikeOutboundFuelHeliox: 1, frigateStrikeReturnFuelHeliox: 1,
    frigateStrikeOutboundDurationSeconds: 60, frigateStrikeReturnDurationSeconds: 60,
    frigateStrikeResolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, frigateStrikeResolverSeed: 'f'.repeat(64),
    frigateStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, frigateStrikePhase: phase,
  } });
  if (phase === 'RETURNING' || phase === 'COMPLETE') {
    await prisma.frigateStrikeReport.create({ data: { missionId: mission.id, attackerId: attacker.id, defenderId: defender.id, createdAt: arrivesAt, resolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, resultSnapshot: { survivors: { attacker: { frigate: options.survivors ?? 2 } } } } });
  }
  return { attacker, defender, origin, target, mission, arrivesAt, returnsAt };
}

function job(data: unknown, name = FRIGATE_STRIKE_ARRIVAL_JOB_NAME, id?: string) {
  return { id, name, data, token: 'test-token', moveToDelayed: jest.fn().mockResolvedValue(undefined) } as unknown as Job;
}

describe('processFrigateStrikeArrivalJob', () => {
  it('settles a due decisive arrival once through the canonical core and ignores forged payload fields', async () => {
    const data = await canonicalFrigateStrike({ defence: 'flakTurret' });
    const queued = job({ missionId: data.mission.id, attacker: 'forged', defender: 'forged', origin: 'forged', target: 'forged', ships: { frigate: 99 }, fuel: 0, result: { forged: true } }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(data.mission.id));
    const duplicate = job({ missionId: data.mission.id, target: 'forged' }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(data.mission.id));
    const results = await Promise.all([processFrigateStrikeArrivalJob(queued), processFrigateStrikeArrivalJob(duplicate)]);
    queueJobs.add(frigateStrikeReturnJobId(data.mission.id));
    expect(results.filter((result) => result === 'arrived')).toHaveLength(1);
    const [mission, report, notices] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } }),
      prisma.frigateStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } }),
      prisma.notification.findMany({ where: { userId: { in: [data.attacker.id, data.defender.id] } } }),
    ]);
    expect(mission).toMatchObject({ status: 'RETURNING', frigateStrikePhase: 'RETURNING', frigateStrikeShips: { frigate: 2 } });
    expect(report.resultSnapshot).toMatchObject({ resolution: 'elimination', starting: { defender: { flakTurret: 1 } } });
    expect(notices).toHaveLength(2);
    expect(await frigateStrikeArrivalQueue.getJob(frigateStrikeReturnJobId(data.mission.id))).toMatchObject({ name: FRIGATE_STRIKE_RETURN_JOB_NAME, data: { missionId: data.mission.id } });
  });

  it('preserves the established Planetary Shield stalemate outcome at due arrival', async () => {
    const data = await canonicalFrigateStrike({ defence: 'planetaryShield' });
    expect(await processFrigateStrikeArrivalJob(job({ missionId: data.mission.id }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(data.mission.id)))).toBe('arrived');
    queueJobs.add(frigateStrikeReturnJobId(data.mission.id));
    expect((await prisma.frigateStrikeReport.findUniqueOrThrow({ where: { missionId: data.mission.id } })).resultSnapshot).toMatchObject({ outcome: 'draw', resolution: 'stalemate', survivors: { attacker: { frigate: 2 }, defender: { planetaryShield: 1 } } });
    expect(await prisma.defence.findUniqueOrThrow({ where: { planetId_key: { planetId: data.target.id, key: 'planetaryShield' } } })).toMatchObject({ count: 1 });
  });

  it('restores surviving Frigates exactly once on a due return, creating missing inventory', async () => {
    const data = await canonicalFrigateStrike({ phase: 'RETURNING' });
    const queued = job({ missionId: data.mission.id, ships: { frigate: 999 } }, FRIGATE_STRIKE_RETURN_JOB_NAME, frigateStrikeReturnJobId(data.mission.id));
    expect(await processFrigateStrikeArrivalJob(queued)).toBe('returned');
    expect(await processFrigateStrikeArrivalJob(queued)).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } })).toMatchObject({ status: 'COMPLETE', frigateStrikePhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } })).toMatchObject({ count: 2 });
  });

  it('moves early arrival and return jobs to persisted deadlines without effects', async () => {
    const arrivalDue = new Date(Date.now() + 60_000);
    const outbound = await canonicalFrigateStrike({ arrivesAt: arrivalDue, returnsAt: new Date(arrivalDue.getTime() + 60_000) });
    const arrivalJob = job({ missionId: outbound.mission.id, arrivesAt: new Date(0) }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(outbound.mission.id));
    expect(await processFrigateStrikeArrivalJob(arrivalJob)).toBe('early');
    expect(arrivalJob.moveToDelayed).toHaveBeenCalledWith(arrivalDue.getTime(), 'test-token');
    expect(await prisma.frigateStrikeReport.count({ where: { missionId: outbound.mission.id } })).toBe(0);
    const returnDue = new Date(Date.now() + 60_000);
    const returning = await canonicalFrigateStrike({ phase: 'RETURNING', returnsAt: returnDue });
    const returnJob = job({ missionId: returning.mission.id, returnsAt: new Date(0) }, FRIGATE_STRIKE_RETURN_JOB_NAME, frigateStrikeReturnJobId(returning.mission.id));
    expect(await processFrigateStrikeArrivalJob(returnJob)).toBe('early');
    expect(returnJob.moveToDelayed).toHaveBeenCalledWith(returnDue.getTime(), 'test-token');
    expect(await prisma.ship.count({ where: { planetId: returning.origin.id, key: 'frigate' } })).toBe(0);
  });

  it('ignores invalid data, legacy, Corvette, cancelled, terminal, malformed, and wrong-phase jobs without side effects', async () => {
    const malformed = await canonicalFrigateStrike({ malformed: true });
    const cancelled = await canonicalFrigateStrike({ cancelled: true });
    const terminal = await canonicalFrigateStrike({ phase: 'COMPLETE' });
    const returning = await canonicalFrigateStrike({ phase: 'RETURNING' });
    const legacy = await prisma.fleetMission.create({ data: { originId: terminal.origin.id, targetId: terminal.target.id, targetGalaxy: terminal.target.galaxy, targetSystem: terminal.target.system, targetSlot: terminal.target.slot, missionType: 'ATTACK', ships: { frigate: 99 }, cargo: {}, arrivesAt: new Date(Date.now() - 1), status: 'OUTBOUND' } });
    const corvette = await prisma.fleetMission.create({ data: { originId: terminal.origin.id, targetId: terminal.target.id, targetGalaxy: terminal.target.galaxy, targetSystem: terminal.target.system, targetSlot: terminal.target.slot, missionType: 'ATTACK', ships: { corvette: 2 }, cargo: {}, arrivesAt: new Date(Date.now() - 1), status: 'OUTBOUND', corvetteStrikeOriginPlanetId: terminal.origin.id, corvetteStrikeTargetPlanetId: terminal.target.id, corvetteStrikeAttackerId: terminal.attacker.id, corvetteStrikeDefenderId: terminal.defender.id, corvetteStrikeShips: { corvette: 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikeResolverVersion: 'corvette-strike-v2', corvetteStrikeResolverSeed: 'c'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: 'OUTBOUND' } });
    expect(await processFrigateStrikeArrivalJob(job({}))).toBe('ignored');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: 'missing' }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: malformed.mission.id }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: cancelled.mission.id }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: terminal.mission.id }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: legacy.id }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: corvette.id }))).toBe('noop');
    expect(await processFrigateStrikeArrivalJob(job({ missionId: returning.mission.id }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(returning.mission.id)))).toBe('ignored');
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.frigateStrikeReport.count({ where: { missionId: { in: [malformed.mission.id, cancelled.mission.id, legacy.id, corvette.id] } } })).toBe(0);
  });

  it('surfaces exhausted transient settlement failures for BullMQ retry without changing state', async () => {
    const data = await canonicalFrigateStrike();
    const transaction = jest.spyOn(prisma as any, '$transaction').mockRejectedValue({ code: 'P2034' });
    await expect(processFrigateStrikeArrivalJob(job({ missionId: data.mission.id }, FRIGATE_STRIKE_ARRIVAL_JOB_NAME, frigateStrikeArrivalJobId(data.mission.id)))).rejects.toThrow('temporarily unavailable');
    transaction.mockRestore();
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.mission.id } })).toMatchObject({ status: 'OUTBOUND', frigateStrikePhase: 'OUTBOUND' });
    expect(await prisma.frigateStrikeReport.count({ where: { missionId: data.mission.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('registers only the dedicated Frigate consumer and leaves legacy Fleet dormant', () => {
    const workerEntry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('frigate-strike-arrival-queue', processFrigateStrikeArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
    expect(readFileSync(resolve(__dirname, '../queues.ts'), 'utf8')).toContain("new Queue('frigate-strike-arrival-queue'");
  });
});

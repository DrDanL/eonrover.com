import { prisma } from '../lib/prisma';
import { corvetteStrikeArrivalQueue, fleetQueue } from '../lib/redis';
import { launchCanonicalCorvetteStrike } from './corvetteStrikeLaunchService';
import { settleCanonicalCorvetteStrike } from '@eonrover/shared';
import {
  CORVETTE_STRIKE_ARRIVAL_JOB_NAME,
  CORVETTE_STRIKE_RETURN_JOB_NAME,
  corvetteStrikeArrivalJobId,
  corvetteStrikeReturnJobId,
  scheduleCorvetteStrikeArrivalWakeup,
  scheduleCorvetteStrikeReturnWakeup,
} from './corvetteStrikeArrivalSchedulingService';

const NOW = new Date('2026-09-14T12:00:00.000Z');
let sequence = 0;
const jobs = new Set<string>();
afterEach(async () => { for (const id of jobs) { const job = await corvetteStrikeArrivalQueue.getJob(id); if (job) await job.remove(); } jobs.clear(); jest.restoreAllMocks(); });

async function fixture() {
  sequence += 1;
  const attacker = await prisma.user.create({ data: { email: `strike-scheduler-a-${sequence}@example.invalid`, username: `strike-scheduler-a-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const defender = await prisma.user.create({ data: { email: `strike-scheduler-d-${sequence}@example.invalid`, username: `strike-scheduler-d-${sequence}`, passwordHash: 'x', status: 'ACTIVE', emailVerifiedAt: NOW } });
  const origin = await prisma.planet.create({ data: { ownerId: attacker.id, name: 'Origin', galaxy: 1, system: 200 + sequence * 2, slot: 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, heliox: 10_000, lastProductionAt: NOW } });
  const target = await prisma.planet.create({ data: { ownerId: defender.id, name: 'Target', galaxy: 1, system: 201 + sequence * 2, slot: 2, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, lastProductionAt: NOW } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'corvette', count: 4 } });
  return { attacker, defender, origin, target };
}
async function mission(data: Awaited<ReturnType<typeof fixture>>, phase: 'OUTBOUND' | 'RETURNING' = 'OUTBOUND', dueOffset = 90_000) {
  const arrival = new Date(NOW.getTime() + (phase === 'OUTBOUND' ? dueOffset : -60_000)); const returning = new Date(NOW.getTime() + (phase === 'RETURNING' ? dueOffset : 120_000));
  return prisma.fleetMission.create({ data: { originId: data.origin.id, targetId: data.target.id, targetGalaxy: data.target.galaxy, targetSystem: data.target.system, targetSlot: data.target.slot, missionType: 'ATTACK', ships: {}, cargo: {}, speedPercent: 100, departedAt: new Date(arrival.getTime() - 60_000), arrivesAt: arrival, returnsAt: returning, status: phase, corvetteStrikeOriginPlanetId: data.origin.id, corvetteStrikeTargetPlanetId: data.target.id, corvetteStrikeAttackerId: data.attacker.id, corvetteStrikeDefenderId: data.defender.id, corvetteStrikeShips: { corvette: 2 }, corvetteStrikeOutboundFuelHeliox: 1, corvetteStrikeReturnFuelHeliox: 1, corvetteStrikeOutboundDurationSeconds: 60, corvetteStrikeReturnDurationSeconds: 60, corvetteStrikeResolverVersion: 'corvette-strike-v1', corvetteStrikeResolverSeed: 'a'.repeat(64), corvetteStrikeAttackerTechnology: { weaponTech: 0, shieldTech: 0, armourTech: 0 }, corvetteStrikePhase: phase } });
}

describe('canonical Corvette strike wake-up scheduling', () => {
  it('uses persisted outbound and return deadlines with exact deterministic contracts', async () => {
    const outbound = await mission(await fixture(), 'OUTBOUND', 90_000); const arrivalId = corvetteStrikeArrivalJobId(outbound.id); jobs.add(arrivalId);
    expect(await scheduleCorvetteStrikeArrivalWakeup(outbound.id, NOW)).toBe('scheduled');
    expect(await corvetteStrikeArrivalQueue.getJob(arrivalId)).toMatchObject({ name: CORVETTE_STRIKE_ARRIVAL_JOB_NAME, data: { missionId: outbound.id }, opts: expect.objectContaining({ jobId: arrivalId, delay: 90_000 }) });
    const returning = await mission(await fixture(), 'RETURNING', 60_000); const returnId = corvetteStrikeReturnJobId(returning.id); jobs.add(returnId);
    expect(await scheduleCorvetteStrikeReturnWakeup(returning.id, NOW)).toBe('scheduled');
    expect(await corvetteStrikeArrivalQueue.getJob(returnId)).toMatchObject({ name: CORVETTE_STRIKE_RETURN_JOB_NAME, data: { missionId: returning.id }, opts: expect.objectContaining({ jobId: returnId, delay: 60_000 }) });
  });
  it('retains live and terminal jobs, and never schedules legacy or ineligible rows', async () => {
    const outbound = await mission(await fixture()); const id = corvetteStrikeArrivalJobId(outbound.id); jobs.add(id);
    expect(await scheduleCorvetteStrikeArrivalWakeup(outbound.id, NOW)).toBe('scheduled'); expect(await scheduleCorvetteStrikeArrivalWakeup(outbound.id, NOW)).toBe('existing');
    const terminal = await mission(await fixture()); jest.spyOn(corvetteStrikeArrivalQueue, 'getJob').mockResolvedValueOnce({ getState: async () => 'completed' } as never); const add = jest.spyOn(corvetteStrikeArrivalQueue, 'add');
    expect(await scheduleCorvetteStrikeArrivalWakeup(terminal.id, NOW)).toBe('retained-terminal'); expect(add).not.toHaveBeenCalled();
    const legacy = await prisma.fleetMission.create({ data: { originId: outbound.originId, targetId: outbound.targetId, targetGalaxy: outbound.targetGalaxy, targetSystem: outbound.targetSystem, targetSlot: outbound.targetSlot, missionType: 'ATTACK', ships: { corvette: 99 }, cargo: {}, arrivesAt: new Date(NOW.getTime() + 1) } });
    expect(await scheduleCorvetteStrikeArrivalWakeup(legacy.id, NOW)).toBe('ineligible');
    await prisma.fleetMission.update({ where: { id: outbound.id }, data: { status: 'COMPLETE', corvetteStrikePhase: 'COMPLETE' } }); expect(await scheduleCorvetteStrikeArrivalWakeup(outbound.id, NOW)).toBe('ineligible');
  });
  it('dispatches only after committed launch and preserves launch state if Redis fails', async () => {
    const data = await fixture(); const add = jest.spyOn(corvetteStrikeArrivalQueue, 'add').mockImplementation(async () => { const [stored, ship] = await Promise.all([prisma.fleetMission.findFirstOrThrow({ where: { corvetteStrikeOriginPlanetId: data.origin.id } }), prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })]); expect(stored.corvetteStrikePhase).toBe('OUTBOUND'); expect(ship.count).toBe(2); return {} as never; });
    await launchCanonicalCorvetteStrike({ userId: data.attacker.id, originPlanetId: data.origin.id, target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, quantity: 2 }); add.mockRestore();
    const failed = await fixture(); jest.spyOn(corvetteStrikeArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    const accepted = await launchCanonicalCorvetteStrike({ userId: failed.attacker.id, originPlanetId: failed.origin.id, target: { galaxy: failed.target.galaxy, system: failed.target.system, slot: failed.target.slot }, quantity: 2 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ corvetteStrikePhase: 'OUTBOUND' }); expect((await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: failed.origin.id, key: 'corvette' } } })).count).toBe(2);
  });
  it('dispatches a return only after committed arrival and retains arrival state when Redis fails', async () => {
    const data = await fixture(); const outbound = await mission(data, 'OUTBOUND', -1);
    const add = jest.spyOn(corvetteStrikeArrivalQueue, 'add').mockImplementation(async () => {
      expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: outbound.id } })).toMatchObject({ status: 'RETURNING', corvetteStrikePhase: 'RETURNING' });
      expect(await prisma.corvetteStrikeReport.count({ where: { missionId: outbound.id } })).toBe(1); return {} as never;
    });
    expect(await settleCanonicalCorvetteStrike(prisma, outbound.id, NOW, { scheduleReturnWakeup: (missionId, now) => scheduleCorvetteStrikeReturnWakeup(missionId, now) })).toBe('arrived');
    add.mockRestore();
    const failed = await mission(await fixture(), 'OUTBOUND', -1);
    jest.spyOn(corvetteStrikeArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await settleCanonicalCorvetteStrike(prisma, failed.id, NOW, { scheduleReturnWakeup: (missionId, now) => scheduleCorvetteStrikeReturnWakeup(missionId, now) })).toBe('arrived');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: 'RETURNING', corvetteStrikePhase: 'RETURNING' });
    expect(await prisma.corvetteStrikeReport.count({ where: { missionId: failed.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [(await prisma.fleetMission.findUniqueOrThrow({ where: { id: failed.id } })).corvetteStrikeAttackerId!, (await prisma.fleetMission.findUniqueOrThrow({ where: { id: failed.id } })).corvetteStrikeDefenderId!] } } })).toBe(2);
  });
  it('keeps the scheduler out of the legacy fleet queue', () => { expect(corvetteStrikeArrivalQueue.name).toBe('corvette-strike-arrival-queue'); expect(fleetQueue.name).toBe('fleet-queue'); });
});

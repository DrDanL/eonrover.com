import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../lib/prisma';
import { fleetQueue, transportArrivalQueue } from '../lib/redis';
import { settleCanonicalTransport } from './transportCompletionService';
import { invalidateUniverseConfigCache } from './gameConfig';
import {
  TRANSPORT_ARRIVAL_JOB_NAME,
  TRANSPORT_RETURN_JOB_NAME,
  scheduleTransportArrivalWakeup,
  scheduleTransportReturnWakeup,
  transportArrivalJobId,
  transportReturnJobId,
} from './transportArrivalSchedulingService';
import { launchCanonicalTransport } from './transportLaunchService';

const NOW = new Date('2026-09-12T12:00:00.000Z');
let coordinate = 1;
let fixtureNumber = 0;
const queuedJobIds = new Set<string>();

beforeEach(() => {
  coordinate = 1;
  fixtureNumber = 0;
  invalidateUniverseConfigCache();
});

afterEach(async () => {
  for (const jobId of queuedJobIds) {
    const job = await transportArrivalQueue.getJob(jobId);
    if (job) await job.remove();
  }
  queuedJobIds.clear();
  jest.restoreAllMocks();
  invalidateUniverseConfigCache();
});

async function fixture() {
  fixtureNumber += 1;
  const user = await prisma.user.create({ data: {
    email: `transport-scheduling-${fixtureNumber}@example.invalid`, username: `transport-scheduling-${fixtureNumber}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport scheduling origin', galaxy: 5, system: 50, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 8_000, heliox: 8_000, aether: 8_000, lastProductionAt: new Date(),
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport scheduling destination', galaxy: 5, system: 50, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(),
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'transporter', count: 5 } });
  return { user, origin, destination };
}

async function outboundMission(data: Awaited<ReturnType<typeof fixture>>, arrivesAt = new Date(NOW.getTime() + 90_000)) {
  const accepted = await launchCanonicalTransport({
    userId: data.user.id,
    originPlanetId: data.origin.id,
    destinationPlanetId: data.destination.id,
    transporterQuantity: 2,
    cargo: { alloy: 1_000, heliox: 500, aether: 200 },
  });
  const jobId = transportArrivalJobId(accepted.missionId);
  const automatic = await transportArrivalQueue.getJob(jobId);
  if (automatic) await automatic.remove();
  await prisma.fleetMission.update({
    where: { id: accepted.missionId },
    data: { departedAt: NOW, arrivesAt },
  });
  return accepted.missionId;
}

async function returningMission(data: Awaited<ReturnType<typeof fixture>>, returnsAt = new Date(NOW.getTime() + 90_000)) {
  const missionId = await outboundMission(data);
  await prisma.fleetMission.update({
    where: { id: missionId },
    data: {
      status: 'RETURNING',
      transportPhase: 'RETURNING',
      transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 },
      returnsAt,
    },
  });
  return missionId;
}

describe('canonical transport wake-up scheduling', () => {
  it('schedules future and due outbound arrivals with the exact deterministic contract', async () => {
    const future = await fixture();
    const futureMissionId = await outboundMission(future, new Date(NOW.getTime() + 90_000));
    const futureJobId = transportArrivalJobId(futureMissionId);
    queuedJobIds.add(futureJobId);
    expect(await scheduleTransportArrivalWakeup(futureMissionId, NOW)).toBe('scheduled');
    const futureJob = await transportArrivalQueue.getJob(futureJobId);
    expect(futureJob).toMatchObject({ name: TRANSPORT_ARRIVAL_JOB_NAME, data: { missionId: futureMissionId } });
    expect(futureJob!.opts).toMatchObject({ jobId: futureJobId, delay: 90_000, removeOnComplete: true, attempts: 3 });

    const due = await fixture();
    const dueMissionId = await outboundMission(due, NOW);
    const dueJobId = transportArrivalJobId(dueMissionId);
    queuedJobIds.add(dueJobId);
    expect(await scheduleTransportArrivalWakeup(dueMissionId, NOW)).toBe('scheduled');
    expect((await transportArrivalQueue.getJob(dueJobId))!.opts.delay).toBe(0);
  });

  it('schedules future and due returns with the exact deterministic contract', async () => {
    const future = await fixture();
    const futureMissionId = await returningMission(future, new Date(NOW.getTime() + 60_000));
    const futureJobId = transportReturnJobId(futureMissionId);
    queuedJobIds.add(futureJobId);
    expect(await scheduleTransportReturnWakeup(futureMissionId, NOW)).toBe('scheduled');
    const futureJob = await transportArrivalQueue.getJob(futureJobId);
    expect(futureJob).toMatchObject({ name: TRANSPORT_RETURN_JOB_NAME, data: { missionId: futureMissionId } });
    expect(futureJob!.opts).toMatchObject({ jobId: futureJobId, delay: 60_000, removeOnComplete: true, attempts: 3 });

    const due = await fixture();
    const dueMissionId = await returningMission(due, new Date(NOW.getTime() - 1));
    const dueJobId = transportReturnJobId(dueMissionId);
    queuedJobIds.add(dueJobId);
    expect(await scheduleTransportReturnWakeup(dueMissionId, NOW)).toBe('scheduled');
    expect((await transportArrivalQueue.getJob(dueJobId))!.opts.delay).toBe(0);
  });

  it('retains one live deterministic job and never replaces a terminal Redis job', async () => {
    const data = await fixture();
    const missionId = await outboundMission(data);
    const jobId = transportArrivalJobId(missionId);
    queuedJobIds.add(jobId);
    const outcomes = await Promise.all([
      scheduleTransportArrivalWakeup(missionId, NOW),
      scheduleTransportArrivalWakeup(missionId, NOW),
      scheduleTransportArrivalWakeup(missionId, NOW),
    ]);
    expect(outcomes.every((outcome) => outcome === 'scheduled' || outcome === 'existing')).toBe(true);
    expect(await scheduleTransportArrivalWakeup(missionId, NOW)).toBe('existing');
    expect((await transportArrivalQueue.getJobs(['waiting', 'delayed'])).filter((job) => job.id === jobId)).toHaveLength(1);

    const terminal = await fixture();
    const terminalMissionId = await outboundMission(terminal);
    const getJob = jest.spyOn(transportArrivalQueue, 'getJob').mockResolvedValueOnce({ getState: async () => 'completed' } as never);
    const add = jest.spyOn(transportArrivalQueue, 'add');
    expect(await scheduleTransportArrivalWakeup(terminalMissionId, NOW)).toBe('retained-terminal');
    expect(add).not.toHaveBeenCalled();
    getJob.mockRestore();
  });

  it('keeps terminal, capacity-waiting, malformed, and legacy rows ineligible without PostgreSQL mutation', async () => {
    const add = jest.spyOn(transportArrivalQueue, 'add');
    const waiting = await fixture();
    const waitingMissionId = await outboundMission(waiting);
    await prisma.fleetMission.update({ where: { id: waitingMissionId }, data: { transportPhase: 'AWAITING_DESTINATION_CAPACITY' } });
    const before = await prisma.fleetMission.findUniqueOrThrow({ where: { id: waitingMissionId } });
    expect(await scheduleTransportArrivalWakeup(waitingMissionId, NOW)).toBe('ineligible');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: waitingMissionId } })).toMatchObject({ transportPhase: before.transportPhase, transportRemainingCargo: before.transportRemainingCargo });

    const terminal = await fixture();
    const terminalMissionId = await outboundMission(terminal);
    await prisma.fleetMission.update({ where: { id: terminalMissionId }, data: { status: 'COMPLETE', transportPhase: 'COMPLETE' } });
    expect(await scheduleTransportArrivalWakeup(terminalMissionId, NOW)).toBe('ineligible');

    const malformed = await fixture();
    const malformedMissionId = await outboundMission(malformed);
    await prisma.fleetMission.update({ where: { id: malformedMissionId }, data: { transportShips: { transporter: 0 } } });
    expect(await scheduleTransportArrivalWakeup(malformedMissionId, NOW)).toBe('ineligible');

    const legacy = await fixture();
    const legacyMission = await prisma.fleetMission.create({ data: {
      originId: legacy.origin.id, targetId: legacy.destination.id,
      targetGalaxy: legacy.destination.galaxy, targetSystem: legacy.destination.system, targetSlot: legacy.destination.slot,
      missionType: 'TRANSPORT', ships: { transporter: 99 }, cargo: { alloy: 99 }, arrivesAt: new Date(NOW.getTime() + 1),
    } });
    const callsBeforeLegacy = add.mock.calls.length;
    expect(await scheduleTransportArrivalWakeup(legacyMission.id, NOW)).toBe('ineligible');
    expect(add).toHaveBeenCalledTimes(callsBeforeLegacy);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('dispatches only after launch commits and preserves acceptance when Redis scheduling fails', async () => {
    const committed = await fixture();
    const add = jest.spyOn(transportArrivalQueue, 'add').mockImplementation(async () => {
      const [mission, origin, ships] = await Promise.all([
        prisma.fleetMission.findFirstOrThrow({ where: { transportOriginId: committed.origin.id } }),
        prisma.planet.findUniqueOrThrow({ where: { id: committed.origin.id } }),
        prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: committed.origin.id, key: 'transporter' } } }),
      ]);
      expect(mission).toMatchObject({ missionType: 'TRANSPORT', transportPhase: 'OUTBOUND' });
      expect(ships.count).toBe(3);
      expect(origin.alloy).toBe(7_000);
      return {} as never;
    });
    const accepted = await launchCanonicalTransport({
      userId: committed.user.id, originPlanetId: committed.origin.id, destinationPlanetId: committed.destination.id,
      transporterQuantity: 2, cargo: { alloy: 1_000, heliox: 500, aether: 200 },
    });
    expect(accepted.schedulingOutcome).toBe('scheduled');
    add.mockRestore();

    const failed = await fixture();
    jest.spyOn(transportArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    const failedAccepted = await launchCanonicalTransport({
      userId: failed.user.id, originPlanetId: failed.origin.id, destinationPlanetId: failed.destination.id,
      transporterQuantity: 2, cargo: { alloy: 1_000, heliox: 500, aether: 200 },
    });
    const [mission, origin, ships] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: failedAccepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: failed.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: failed.origin.id, key: 'transporter' } } }),
    ]);
    expect(failedAccepted.schedulingOutcome).toBe('failed');
    expect(mission).toMatchObject({ transportPhase: 'OUTBOUND', transportShips: { transporter: 2 } });
    expect(ships.count).toBe(3);
    expect(origin).toMatchObject({ alloy: 7_000, aether: 7_800 });
  });

  it('schedules a return only after delivery commits and retains delivery when return scheduling fails', async () => {
    const delivered = await fixture();
    const missionId = await outboundMission(delivered, NOW);
    const add = jest.spyOn(transportArrivalQueue, 'add').mockImplementation(async () => {
      const [mission, destination] = await Promise.all([
        prisma.fleetMission.findUniqueOrThrow({ where: { id: missionId } }),
        prisma.planet.findUniqueOrThrow({ where: { id: delivered.destination.id } }),
      ]);
      expect(mission).toMatchObject({ status: 'RETURNING', transportPhase: 'RETURNING' });
      expect(destination).toMatchObject({ alloy: 2_000, heliox: 1_500, aether: 1_200 });
      return {} as never;
    });
    expect(await settleCanonicalTransport(missionId, NOW)).toBe('delivered');
    const returnJobId = transportReturnJobId(missionId);
    expect(add).toHaveBeenCalledWith(
      TRANSPORT_RETURN_JOB_NAME,
      { missionId },
      expect.objectContaining({ jobId: returnJobId, removeOnComplete: true, attempts: 3 }),
    );
    add.mockRestore();

    const failed = await fixture();
    const failedMissionId = await outboundMission(failed, NOW);
    jest.spyOn(transportArrivalQueue, 'add').mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await settleCanonicalTransport(failedMissionId, NOW)).toBe('delivered');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: failedMissionId } })).toMatchObject({ status: 'RETURNING', transportPhase: 'RETURNING' });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: failed.destination.id } })).toMatchObject({ alloy: 2_000, heliox: 1_500, aether: 1_200 });
  });

  it('registers only the dedicated transport queue consumer and leaves the legacy fleet queue untouched', () => {
    const root = resolve(__dirname, '../../../..');
    const workerEntry = readFileSync(resolve(root, 'apps/worker/src/index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('transport-arrival-queue', processTransportArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
    expect(readFileSync(resolve(root, 'apps/api/src/routes/fleet.ts'), 'utf8')).not.toContain('transport-arrival-queue');
    expect(fleetQueue.name).toBe('fleet-queue');
    expect(transportArrivalQueue.name).toBe('transport-arrival-queue');
  });
});

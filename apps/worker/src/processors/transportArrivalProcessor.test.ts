import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import { prisma } from '../prisma';
import { transportArrivalQueue } from '../queues';
import {
  processTransportArrivalJob,
  TRANSPORT_ARRIVAL_JOB_NAME,
  TRANSPORT_RETURN_JOB_NAME,
} from './transportArrivalProcessor';

let coordinate = 1;
const queuedJobIds = new Set<string>();

afterEach(async () => {
  for (const id of queuedJobIds) {
    const queued = await transportArrivalQueue.getJob(id);
    if (queued) await queued.remove();
  }
  queuedJobIds.clear();
});

async function canonicalTransport(options: {
  phase?: 'OUTBOUND' | 'RETURNING' | 'AWAITING_DESTINATION_CAPACITY' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  malformed?: boolean;
} = {}) {
  const user = await prisma.user.create({ data: {
    email: `transport-worker-${coordinate}@example.invalid`, username: `transport-worker-${coordinate}`, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport worker origin', galaxy: 20, system: coordinate, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: new Date(),
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport worker destination', galaxy: 20, system: coordinate++, slot: 2,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 10, heliox: 10, aether: 10, lastProductionAt: new Date(),
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'transporter', count: 3 } });
  const phase = options.phase ?? 'OUTBOUND';
  const arrivesAt = options.arrivesAt ?? new Date(Date.now() - 1_000);
  const returnsAt = options.returnsAt ?? new Date(Date.now() - 1_000);
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: destination.id, targetGalaxy: destination.galaxy, targetSystem: destination.system, targetSlot: destination.slot,
    missionType: 'TRANSPORT', ships: { transporter: 999 }, cargo: { alloy: 999 }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, returnsAt: phase === 'RETURNING' ? returnsAt : null,
    status: phase === 'RETURNING' ? 'RETURNING' : phase === 'COMPLETE' ? 'COMPLETE' : 'OUTBOUND',
    transportOriginId: origin.id, transportDestinationId: destination.id,
    transportShips: options.malformed ? { transporter: 0 } : { transporter: 2 },
    transportCargo: { alloy: 100, heliox: 50, aether: 20 },
    transportRemainingCargo: phase === 'RETURNING' || phase === 'COMPLETE' ? { alloy: 0, heliox: 0, aether: 0 } : { alloy: 100, heliox: 50, aether: 20 },
    transportCapacity: 10_000, transportOutboundFuelHeliox: 10, transportReturnFuelHeliox: 10, transportTotalReservedFuelHeliox: 20,
    transportOutboundDurationSeconds: 60, transportReturnDurationSeconds: 60, transportPhase: phase,
  } });
  return { user, origin, destination, mission };
}

function job(data: unknown, name = TRANSPORT_ARRIVAL_JOB_NAME, id?: string) {
  return { id, name, data, token: 'test-token', moveToDelayed: jest.fn().mockResolvedValue(undefined) } as unknown as Job;
}

describe('processTransportArrivalJob', () => {
  it('settles due arrivals only through persisted transport state and ignores forged payload values', async () => {
    const fixture = await canonicalTransport();
    const queued = job({
      missionId: fixture.mission.id, accountId: 'forged', originId: 'forged', destinationId: 'forged',
      ships: { transporter: 99 }, cargo: { alloy: 99_999 }, fuel: 0, arrivesAt: new Date(0), phase: 'RETURNING',
    });
    expect(await processTransportArrivalJob(queued)).toBe('delivered');
    const [mission, destination, originShips] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: fixture.destination.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'transporter' } } }),
    ]);
    expect(mission).toMatchObject({ status: 'RETURNING', transportPhase: 'RETURNING', transportShips: { transporter: 2 } });
    expect(destination).toMatchObject({ alloy: 110, heliox: 60, aether: 30 });
    expect(originShips.count).toBe(3);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  it('settles due returns only through the authoritative completion service', async () => {
    const fixture = await canonicalTransport({ phase: 'RETURNING' });
    const queued = job({ missionId: fixture.mission.id, cargo: { alloy: 999 } }, TRANSPORT_RETURN_JOB_NAME);
    expect(await processTransportArrivalJob(queued)).toBe('returned');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE', transportPhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'transporter' } } })).toMatchObject({ count: 5 });
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_RETURNED' } })).toBe(1);
  });

  it('moves early arrival and return jobs to persisted due times without side effects', async () => {
    const arrivalDue = new Date(Date.now() + 60_000);
    const arrival = await canonicalTransport({ arrivesAt: arrivalDue });
    const arrivalJob = job({ missionId: arrival.mission.id, arrivesAt: new Date(0) });
    expect(await processTransportArrivalJob(arrivalJob)).toBe('early');
    expect(arrivalJob.moveToDelayed).toHaveBeenCalledWith(arrivalDue.getTime(), 'test-token');
    expect(await prisma.notification.count({ where: { userId: arrival.user.id } })).toBe(0);

    const returnDue = new Date(Date.now() + 60_000);
    const returning = await canonicalTransport({ phase: 'RETURNING', returnsAt: returnDue });
    const returnJob = job({ missionId: returning.mission.id, returnsAt: new Date(0) }, TRANSPORT_RETURN_JOB_NAME);
    expect(await processTransportArrivalJob(returnJob)).toBe('early');
    expect(returnJob.moveToDelayed).toHaveBeenCalledWith(returnDue.getTime(), 'test-token');
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: returning.origin.id, key: 'transporter' } } })).toMatchObject({ count: 3 });
  });

  it('keeps missing, terminal, legacy, malformed, phase-mismatched, and capacity-waiting jobs inert', async () => {
    const terminal = await canonicalTransport({ phase: 'COMPLETE' });
    const malformed = await canonicalTransport({ malformed: true });
    const waiting = await canonicalTransport({ phase: 'AWAITING_DESTINATION_CAPACITY' });
    const legacy = await prisma.fleetMission.create({ data: {
      originId: waiting.origin.id, targetId: waiting.destination.id, targetGalaxy: waiting.destination.galaxy, targetSystem: waiting.destination.system, targetSlot: waiting.destination.slot,
      missionType: 'TRANSPORT', ships: { transporter: 2 }, cargo: { alloy: 1 }, arrivesAt: new Date(Date.now() - 1),
    } });
    expect(await processTransportArrivalJob(job({ missionId: 'missing' }))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: terminal.mission.id }))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: malformed.mission.id }))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: waiting.mission.id }))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: legacy.id }))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: terminal.mission.id }, TRANSPORT_RETURN_JOB_NAME))).toBe('noop');
    expect(await processTransportArrivalJob(job({ missionId: malformed.mission.id }, TRANSPORT_ARRIVAL_JOB_NAME, 'forged-job-id'))).toBe('ignored');
    expect(await prisma.notification.count()).toBe(0);
  });

  it('makes duplicate delivery exactly once and registers only the dedicated transport consumer', async () => {
    const fixture = await canonicalTransport();
    const [first, second] = await Promise.all([
      processTransportArrivalJob(job({ missionId: fixture.mission.id })),
      processTransportArrivalJob(job({ missionId: fixture.mission.id })),
    ]);
    expect([first, second].filter((outcome) => outcome === 'delivered')).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.destination.id } })).toMatchObject({ alloy: 110, heliox: 60, aether: 30 });

    const workerEntry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('transport-arrival-queue', processTransportArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
  });
});

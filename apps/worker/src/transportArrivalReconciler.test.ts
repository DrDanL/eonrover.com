import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  transportArrivalJobId,
  transportReturnJobId,
  TransportSchedulingOutcome,
} from '@eonrover/shared';
import { BuildingReconciliationTimer } from './buildingReconciler';
import { prisma } from './prisma';
import { processTransportArrivalJob, TRANSPORT_ARRIVAL_JOB_NAME } from './processors/transportArrivalProcessor';
import {
  reconcilePendingTransportArrivalJobs,
  startTransportArrivalReconciliation,
  TransportArrivalReconciliationLoop,
} from './transportArrivalReconciler';

const NOW = new Date('2026-09-12T12:00:00.000Z');
let coordinate = 1;

type MockQueue = { add: jest.Mock; getJob: jest.Mock };

function mockQueue(existing = new Map<string, string>()): MockQueue {
  return {
    getJob: jest.fn(async (jobId: string) => {
      const state = existing.get(jobId);
      return state ? { getState: jest.fn().mockResolvedValue(state) } : undefined;
    }),
    add: jest.fn(async (_name, _data, options) => {
      existing.set(String(options.jobId), 'delayed');
      return { id: options.jobId };
    }),
  };
}

async function canonicalTransport(options: {
  phase?: 'OUTBOUND' | 'AWAITING_DESTINATION_CAPACITY' | 'RETURNING' | 'COMPLETE';
  arrivesAt?: Date;
  returnsAt?: Date;
  destinationResources?: { alloy: number; heliox: number; aether: number };
  malformed?: boolean;
} = {}) {
  const user = await prisma.user.create({ data: {
    email: `transport-reconcile-${coordinate}@example.invalid`, username: `transport-reconcile-${coordinate}`, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: NOW,
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport reconcile origin', galaxy: 30, system: coordinate, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Transport reconcile destination', galaxy: 30, system: coordinate++, slot: 2,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: options.destinationResources?.alloy ?? 10, heliox: options.destinationResources?.heliox ?? 10, aether: options.destinationResources?.aether ?? 10,
    lastProductionAt: NOW,
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'transporter', count: 3 } });
  const phase = options.phase ?? 'OUTBOUND';
  const arrivesAt = options.arrivesAt ?? new Date(NOW.getTime() - 1);
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: destination.id, targetGalaxy: destination.galaxy, targetSystem: destination.system, targetSlot: destination.slot,
    missionType: 'TRANSPORT', ships: { transporter: 999 }, cargo: { alloy: 999 }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt,
    returnsAt: phase === 'RETURNING' ? options.returnsAt ?? new Date(NOW.getTime() - 1) : null,
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

describe('transport-arrival reconciliation', () => {
  it('settles overdue outbound delivery and overdue return exactly once', async () => {
    const outbound = await canonicalTransport();
    const arrivalQueue = mockQueue();
    const first = await reconcilePendingTransportArrivalJobs(prisma, arrivalQueue as never, NOW);
    expect(first).toEqual({ scanned: 1, settled: 1, scheduled: 0, existing: 0, skipped: 0, failed: 0 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: outbound.destination.id } })).toMatchObject({ alloy: 110, heliox: 60, aether: 30 });
    expect(await prisma.notification.count({ where: { userId: outbound.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);

    await prisma.fleetMission.update({ where: { id: outbound.mission.id }, data: { returnsAt: new Date(NOW.getTime() - 1) } });
    const second = await reconcilePendingTransportArrivalJobs(prisma, arrivalQueue as never, NOW);
    expect(second.settled).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: outbound.origin.id, key: 'transporter' } } })).toMatchObject({ count: 5 });
    expect(await prisma.notification.count({ where: { userId: outbound.user.id, type: 'TRANSPORT_RETURNED' } })).toBe(1);
  });

  it('retries capacity waiting safely, then delivers the original cargo once when storage becomes available', async () => {
    const fixture = await canonicalTransport({ destinationResources: { alloy: 10_000, heliox: 10_000, aether: 10_000 } });
    const queue = mockQueue();
    const first = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW);
    expect(first.skipped).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_AWAITING_CAPACITY' } })).toBe(1);
    const second = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW);
    expect(second.skipped).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_AWAITING_CAPACITY' } })).toBe(1);

    await prisma.planet.update({ where: { id: fixture.destination.id }, data: { alloy: 0, heliox: 0, aether: 0, lastProductionAt: NOW } });
    const delivered = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW);
    expect(delivered.settled).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'RETURNING', transportPhase: 'RETURNING', transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 } });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.destination.id } })).toMatchObject({ alloy: 100, heliox: 50, aether: 20 });
    expect(queue.add).toHaveBeenCalledWith('complete-transport-return', { missionId: fixture.mission.id }, expect.objectContaining({ jobId: transportReturnJobId(fixture.mission.id) }));
  });

  it('restores missing future arrival and return jobs with their deterministic persisted contracts', async () => {
    const outbound = await canonicalTransport({ arrivesAt: new Date(NOW.getTime() + 90_000) });
    const returning = await canonicalTransport({ phase: 'RETURNING', returnsAt: new Date(NOW.getTime() + 60_000) });
    const queue = mockQueue();
    const result = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW);
    expect(result).toEqual({ scanned: 2, settled: 0, scheduled: 2, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith('complete-transport-arrival', { missionId: outbound.mission.id }, expect.objectContaining({ jobId: transportArrivalJobId(outbound.mission.id), delay: 90_000 }));
    expect(queue.add).toHaveBeenCalledWith('complete-transport-return', { missionId: returning.mission.id }, expect.objectContaining({ jobId: transportReturnJobId(returning.mission.id), delay: 60_000 }));
  });

  it('retains existing jobs and safely skips malformed, legacy, terminal rows while continuing after a failure', async () => {
    const future = await canonicalTransport({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const malformed = await canonicalTransport({ malformed: true, arrivesAt: new Date(NOW.getTime() + 60_000) });
    await canonicalTransport({ phase: 'COMPLETE' });
    const legacy = await prisma.fleetMission.create({ data: {
      originId: future.origin.id, targetId: future.destination.id, targetGalaxy: future.destination.galaxy, targetSystem: future.destination.system, targetSlot: future.destination.slot,
      missionType: 'TRANSPORT', ships: { transporter: 2 }, cargo: { alloy: 1 }, arrivesAt: new Date(NOW.getTime() + 60_000),
    } });
    const queue = mockQueue(new Map([[transportArrivalJobId(future.mission.id), 'waiting']]));
    const result = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW);
    expect(result).toEqual({ scanned: 2, settled: 0, scheduled: 0, existing: 1, skipped: 1, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ transportPhase: null });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('caps scans at 100 and keeps a failed row from blocking later work', async () => {
    const queue = mockQueue();
    const database = { fleetMission: { findMany: jest.fn().mockResolvedValue([]) } };
    await reconcilePendingTransportArrivalJobs(database as never, queue as never, NOW, 10_000);
    expect(database.fleetMission.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));

    const first = await canonicalTransport({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const second = await canonicalTransport({ arrivesAt: new Date(NOW.getTime() + 60_000) });
    const schedule = jest.fn<Promise<TransportSchedulingOutcome>, [string, Date]>()
      .mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValueOnce('scheduled');
    const result = await reconcilePendingTransportArrivalJobs(prisma, queue as never, NOW, 100, undefined, schedule, schedule);
    expect(result).toEqual({ scanned: 2, settled: 0, scheduled: 1, existing: 0, skipped: 0, failed: 1 });
    expect(schedule).toHaveBeenCalledWith(first.mission.id, NOW);
    expect(schedule).toHaveBeenCalledWith(second.mission.id, NOW);
  });
});

describe('transport-arrival reconciliation lifecycle', () => {
  it('runs immediately, repeats every 30 seconds, prevents overlap, and clears its interval', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = {
      setInterval(next, intervalMs) { expect(intervalMs).toBe(30_000); callback = next; return 'transport-arrival-interval'; },
      clearInterval: jest.fn(),
    };
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const loop: TransportArrivalReconciliationLoop = startTransportArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    callback?.();
    expect(await loop.runNow()).toBe(false);
    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    callback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop();
    expect(timer.clearInterval).toHaveBeenCalledWith('transport-arrival-interval');
  });

  it('keeps a concurrent worker delivery and reconciliation exactly once, and leaves legacy fleet work dormant', async () => {
    const fixture = await canonicalTransport({ arrivesAt: new Date(Date.now() - 1_000) });
    const queue = mockQueue();
    const job = { name: TRANSPORT_ARRIVAL_JOB_NAME, data: { missionId: fixture.mission.id }, token: 'token', moveToDelayed: jest.fn() } as never;
    await Promise.all([
      processTransportArrivalJob(job),
      reconcilePendingTransportArrivalJobs(prisma, queue as never, new Date()),
    ]);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.destination.id } })).toMatchObject({ alloy: 110, heliox: 60, aether: 30 });
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
    const entry = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    expect(entry).toContain('startTransportArrivalReconciliation(');
    expect(entry).toContain('transportArrivalReconciliation?.stop()');
    expect(entry).not.toContain("new Worker('fleet-queue'");
  });
});

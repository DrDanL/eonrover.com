import { deployArrivalJobId } from '@eonrover/shared';
import { MissionStatus, MissionType, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import {
  DeployArrivalReconciliationLoop,
  reconcilePendingDeployArrivalJobs,
  startDeployArrivalReconciliation,
} from './deployArrivalReconciler';
import { BuildingReconciliationTimer } from './buildingReconciler';

const NOW = new Date('2026-09-10T12:00:00.000Z');
let coordinate = 220;

type MockQueue = {
  add: jest.Mock;
  getJob: jest.Mock;
};

function mockQueue(): MockQueue {
  const liveJobs = new Map<string, string>();
  return {
    getJob: jest.fn(async (jobId: string) => {
      const state = liveJobs.get(jobId);
      return state ? { getState: jest.fn().mockResolvedValue(state) } : undefined;
    }),
    add: jest.fn(async (_name, _data, options) => {
      liveJobs.set(String(options.jobId), 'delayed');
      return { id: options.jobId };
    }),
  };
}

async function canonicalDeploy(arrivesAt: Date, options: {
  deployShips?: unknown;
  missionType?: MissionType;
  status?: MissionStatus;
} = {}) {
  const user = await prisma.user.create({ data: {
    email: `deploy-reconcile-${coordinate}@example.invalid`, username: `deploy-reconcile-${coordinate}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: NOW,
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Deploy reconciliation origin ${coordinate}`, galaxy: 8, system: 8, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  const destination = await prisma.planet.create({ data: {
    ownerId: user.id, name: `Deploy reconciliation destination ${coordinate}`, galaxy: 8, system: 8, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 1_000, aether: 1_000, lastProductionAt: NOW,
  } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: 3 } });
  const mission = await prisma.fleetMission.create({ data: {
    originId: origin.id, targetId: destination.id,
    targetGalaxy: destination.galaxy, targetSystem: destination.system, targetSlot: destination.slot,
    missionType: options.missionType ?? 'DEPLOY', ships: { scout: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 },
    speedPercent: 100, departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt,
    status: options.status ?? 'OUTBOUND', deployOriginId: origin.id, deployDestinationId: destination.id,
    deployShips: options.deployShips ?? { scout: 2 }, deployFuelHeliox: 1, deployDurationSeconds: 60,
  } });
  return { user, origin, destination, mission };
}

describe('deploy-arrival reconciliation', () => {
  it('completes one overdue canonical deploy exactly once with one transfer and notification', async () => {
    const fixture = await canonicalDeploy(new Date(NOW.getTime() - 1));
    const queue = mockQueue();

    const [first, second] = await Promise.all([
      reconcilePendingDeployArrivalJobs(prisma, queue as never, NOW),
      reconcilePendingDeployArrivalJobs(prisma, queue as never, NOW),
    ]);

    expect(first.completed + second.completed).toBe(1);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.destination.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('restores a missing future deterministic job using its persisted arrival time', async () => {
    const fixture = await canonicalDeploy(new Date(NOW.getTime() + 90_000));
    const queue = mockQueue();

    const result = await reconcilePendingDeployArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 1, completed: 0, scheduled: 1, existing: 0, skipped: 0, failed: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'complete-deploy-arrival',
      { missionId: fixture.mission.id },
      expect.objectContaining({ jobId: deployArrivalJobId(fixture.mission.id), delay: 90_000 }),
    );
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.ship.count({ where: { planetId: fixture.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('retains an existing valid deterministic job and never replaces it', async () => {
    const fixture = await canonicalDeploy(new Date(NOW.getTime() + 60_000));
    const queue = mockQueue();
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') });

    const result = await reconcilePendingDeployArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 1, completed: 0, scheduled: 0, existing: 1, skipped: 0, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips legacy, malformed, terminal, and non-deploy rows without side effects', async () => {
    const legacy = await canonicalDeploy(new Date(NOW.getTime() + 60_000));
    await prisma.fleetMission.update({ where: { id: legacy.mission.id }, data: {
      deployOriginId: null, deployDestinationId: null, deployShips: Prisma.JsonNull, deployFuelHeliox: null, deployDurationSeconds: null,
    } });
    const malformed = await canonicalDeploy(new Date(NOW.getTime() + 60_000), { deployShips: { scout: 0 } });
    await canonicalDeploy(new Date(NOW.getTime() + 60_000), { status: 'COMPLETE' });
    await canonicalDeploy(new Date(NOW.getTime() + 60_000), { missionType: 'TRANSPORT' });
    const queue = mockQueue();

    const result = await reconcilePendingDeployArrivalJobs(prisma, queue as never, NOW);

    expect(result).toEqual({ scanned: 2, completed: 0, scheduled: 0, existing: 0, skipped: 2, failed: 0 });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: legacy.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: malformed.mission.id } })).toMatchObject({ status: 'OUTBOUND' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('deploy-arrival reconciliation loop', () => {
  it('runs immediately, uses the 30-second interval, and prevents overlap', async () => {
    let callback: (() => void) | undefined;
    const timer: BuildingReconciliationTimer = {
      setInterval(next, intervalMs) {
        expect(intervalMs).toBe(30_000);
        callback = next;
        return 'deploy-arrival-interval';
      },
      clearInterval: jest.fn(),
    };
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);

    const loop: DeployArrivalReconciliationLoop = startDeployArrivalReconciliation(reconcile, 30_000, () => undefined, timer);
    expect(reconcile).toHaveBeenCalledTimes(1);
    callback?.();
    expect(await loop.runNow()).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);

    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    callback?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reconcile).toHaveBeenCalledTimes(2);
    loop.stop();
    expect(timer.clearInterval).toHaveBeenCalledWith('deploy-arrival-interval');
  });
});

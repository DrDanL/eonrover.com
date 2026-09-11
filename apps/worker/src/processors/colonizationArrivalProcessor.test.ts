import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import { COLONY_STARTER_STATE, deriveColonyCharacteristics } from '@eonrover/shared';
import { prisma } from '../prisma';
import {
  COLONIZATION_ARRIVAL_JOB_NAME,
  processColonizationArrivalJob,
} from './colonizationArrivalProcessor';

let coordinate = 1;

async function canonicalColonization(options: { arrivesAt?: Date; status?: 'OUTBOUND' | 'COMPLETE'; malformed?: boolean } = {}) {
  const system = 800 + coordinate;
  const user = await prisma.user.create({ data: {
    email: `colony-worker-${coordinate}@example.invalid`, username: `colony-worker-${coordinate++}`,
    passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const origin = await prisma.planet.create({ data: {
    ownerId: user.id, name: 'Colonisation worker origin', galaxy: 12, system, slot: 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox: 900, aether: 100, lastProductionAt: new Date(),
  } });
  const missionId = randomUUID();
  const arrivesAt = options.arrivesAt ?? new Date(Date.now() - 1_000);
  const departedAt = new Date(arrivesAt.getTime() - 60_000);
  const mission = await prisma.fleetMission.create({ data: {
    id: missionId,
    originId: origin.id, targetId: null,
    targetGalaxy: origin.galaxy, targetSystem: origin.system, targetSlot: 4,
    missionType: 'COLONIZE', ships: { colonyShip: 999 }, cargo: { alloy: 999, heliox: 999, aether: 999 },
    speedPercent: 100, departedAt, arrivesAt, status: options.status ?? 'OUTBOUND',
    colonizationAccountId: user.id,
    colonizationTargetGalaxy: origin.galaxy, colonizationTargetSystem: origin.system, colonizationTargetSlot: 4,
    colonizationShips: { colonyShip: 1 }, colonizationFuelHeliox: 100, colonizationDurationSeconds: 60,
    colonizationCharacteristics: deriveColonyCharacteristics(missionId),
    colonizationStarterState: options.malformed ? { resources: { alloy: 999 } } : {
      fieldCapacity: COLONY_STARTER_STATE.fieldCapacity,
      resources: { ...COLONY_STARTER_STATE.resources },
      buildings: { ...COLONY_STARTER_STATE.buildings },
    },
  } });
  return { user, origin, mission };
}

function job(data: unknown, name = COLONIZATION_ARRIVAL_JOB_NAME) {
  return {
    name, data, token: 'test-token', moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

describe('processColonizationArrivalJob', () => {
  it('completes a due canonical colonisation exactly once and ignores forged queue state', async () => {
    const fixture = await canonicalColonization();
    const queued = job({
      missionId: fixture.mission.id,
      accountId: 'forged-account', originId: 'forged-origin', targetGalaxy: 99, targetSystem: 99, targetSlot: 12,
      ships: { scout: 999 }, cargo: { heliox: 999 }, fuelHeliox: 0, characteristics: { planetType: 'GAS_GIANT' },
    });

    const persisted = await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } });
    expect(await processColonizationArrivalJob(queued)).toBe('completed');
    expect(await processColonizationArrivalJob(queued)).toBe('noop');
    const colony = await prisma.planet.findUniqueOrThrow({ where: { galaxy_system_slot: { galaxy: 12, system: fixture.origin.system, slot: 4 } } });
    expect(colony).toMatchObject({ ownerId: fixture.user.id, fieldCapacity: 180, alloy: 500, heliox: 300, aether: 0 });
    const characteristics = persisted.colonizationCharacteristics as { planetType: string; temperature: number; solarIndex: number };
    expect(colony).toMatchObject({
      planetType: {
        temperate: 'TEMPERATE', volcanic: 'VOLCANIC', ice: 'ICE', gasGiant: 'GAS_GIANT', barren: 'BARREN', oceanic: 'OCEANIC',
      }[characteristics.planetType],
      temperature: characteristics.temperature,
      solarIndex: characteristics.solarIndex,
    });
    expect(await prisma.planet.count({ where: { galaxy: 99, system: 99, slot: 12 } })).toBe(0);
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE', createdPlanetId: colony.id });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: fixture.origin.id } })).toMatchObject({ heliox: 900 });
    expect(await prisma.ship.count({ where: { planetId: fixture.origin.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'COLONY_FOUNDED' } })).toBe(1);
    expect(queued.moveToDelayed).not.toHaveBeenCalled();
  });

  it('reschedules early delivery from the persisted arrival time without game-state side effects', async () => {
    const arrivesAt = new Date(Date.now() + 60_000);
    const fixture = await canonicalColonization({ arrivesAt });
    const queued = job({ missionId: fixture.mission.id, arrivesAt: new Date(0), result: 'forged' });

    expect(await processColonizationArrivalJob(queued)).toBe('early');
    expect(queued.moveToDelayed).toHaveBeenCalledWith(arrivesAt.getTime(), 'test-token');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'OUTBOUND', createdPlanetId: null });
    expect(await prisma.planet.count({ where: { ownerId: fixture.user.id } })).toBe(1);
    expect(await prisma.ship.count({ where: { planetId: fixture.origin.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fixture.user.id } })).toBe(0);
  });

  it('keeps duplicate, missing, terminal, and malformed delivery safe', async () => {
    const due = await canonicalColonization();
    const outcomes = await Promise.all([
      processColonizationArrivalJob(job({ missionId: due.mission.id })),
      processColonizationArrivalJob(job({ missionId: due.mission.id })),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'completed')).toHaveLength(1);
    expect(await prisma.planet.count({ where: { ownerId: due.user.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: due.user.id, type: 'COLONY_FOUNDED' } })).toBe(1);

    const terminal = await canonicalColonization({ status: 'COMPLETE' });
    const malformed = await canonicalColonization({ malformed: true });
    expect(await processColonizationArrivalJob(job({ missionId: 'missing' }))).toBe('noop');
    expect(await processColonizationArrivalJob(job({ missionId: terminal.mission.id }))).toBe('noop');
    expect(await processColonizationArrivalJob(job({ missionId: malformed.mission.id }))).toBe('noop');
    expect(await processColonizationArrivalJob(job({ missionId: due.mission.id }, 'fleet-arrival'))).toBe('ignored');
    expect(await prisma.notification.count({ where: { userId: { in: [terminal.user.id, malformed.user.id] } } })).toBe(0);
  });

  it('keeps a target-occupied completion terminal and idempotent', async () => {
    const fixture = await canonicalColonization();
    const intruder = await prisma.user.create({ data: {
      email: 'colony-worker-intruder@example.invalid', username: 'colony-worker-intruder', passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
    } });
    await prisma.planet.create({ data: {
      ownerId: intruder.id, name: 'Occupied colony target', galaxy: 12, system: fixture.origin.system, slot: 4,
      planetType: 'BARREN', temperature: -20, solarIndex: 0.3, lastProductionAt: new Date(),
    } });
    const queued = job({ missionId: fixture.mission.id, targetSlot: 12, ships: { scout: 999 } });

    expect(await processColonizationArrivalJob(queued)).toBe('failed');
    expect(await processColonizationArrivalJob(queued)).toBe('noop');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: fixture.mission.id } })).toMatchObject({ status: 'COMPLETE', createdPlanetId: null });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: fixture.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
    expect(await prisma.notification.count({ where: { userId: fixture.user.id, type: 'COLONY_FAILED' } })).toBe(1);
  });

  it('registers only the dedicated colonisation consumer and leaves legacy fleet jobs dormant', () => {
    const workerEntry = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    expect(workerEntry).toContain("new Worker('colonization-arrival-queue', processColonizationArrivalJob");
    expect(workerEntry).not.toContain("new Worker('fleet-queue'");
  });
});

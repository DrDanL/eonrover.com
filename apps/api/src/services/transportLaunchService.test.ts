import { planTransportMission } from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { fleetQueue } from '../lib/redis';
import { invalidateUniverseConfigCache } from './gameConfig';
import {
  TransportLaunchInput,
  launchCanonicalTransport,
} from './transportLaunchService';

let coordinate = 1;

beforeEach(() => {
  coordinate = 1;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function createPlayer(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
}

async function createPlanet(
  ownerId: string,
  name: string,
  resources: { alloy?: number; heliox?: number; aether?: number } = {},
) {
  return prisma.planet.create({
    data: {
      ownerId,
      name,
      galaxy: 3,
      system: 30,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      // Level-zero storage caps each resource at 10,000 during the
      // authoritative production sync performed by launch.
      alloy: resources.alloy ?? 10_000,
      heliox: resources.heliox ?? 10_000,
      aether: resources.aether ?? 10_000,
      lastProductionAt: new Date(),
    },
  });
}

async function fixture(options: {
  transporters?: number;
  originResources?: { alloy?: number; heliox?: number; aether?: number };
} = {}) {
  const owner = await createPlayer(`transport-owner-${coordinate}`);
  const origin = await createPlanet(owner.id, 'Transport origin', options.originResources);
  const destination = await createPlanet(owner.id, 'Transport destination');
  await prisma.ship.create({
    data: { planetId: origin.id, key: 'transporter', count: options.transporters ?? 5 },
  });
  return { owner, origin, destination };
}

function input(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<TransportLaunchInput> = {},
): TransportLaunchInput {
  return {
    userId: value.owner.id,
    originPlanetId: value.origin.id,
    destinationPlanetId: value.destination.id,
    transporterQuantity: 2,
    cargo: { alloy: 1000, heliox: 500, aether: 200 },
    ...overrides,
  };
}

async function expectServiceError(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({ name: 'TransportLaunchError', code });
}

async function canonicalTransport(originId: string, destinationId: string) {
  return prisma.fleetMission.create({
    data: {
      originId,
      targetId: destinationId,
      targetGalaxy: 3,
      targetSystem: 30,
      targetSlot: 12,
      missionType: 'TRANSPORT',
      ships: { transporter: 1 },
      cargo: { alloy: 1, heliox: 0, aether: 0 },
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      returnsAt: new Date('2026-12-01T00:01:00.000Z'),
      transportOriginId: originId,
      transportDestinationId: destinationId,
      transportShips: { transporter: 1 },
      transportCargo: { alloy: 1, heliox: 0, aether: 0 },
      transportRemainingCargo: { alloy: 1, heliox: 0, aether: 0 },
      transportCapacity: 4000,
      transportOutboundFuelHeliox: 1,
      transportReturnFuelHeliox: 1,
      transportTotalReservedFuelHeliox: 2,
      transportOutboundDurationSeconds: 60,
      transportReturnDurationSeconds: 60,
      transportPhase: 'OUTBOUND',
    },
  });
}

describe('launchCanonicalTransport', () => {
  it('persists canonical snapshots and atomically reserves Transporters, cargo, and round-trip Heliox', async () => {
    const candidate = await fixture({ transporters: 5 });
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const beforeDestination = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.destination.id } });
    const addJob = jest.spyOn(fleetQueue, 'add');
    const accepted = await launchCanonicalTransport(input(candidate));
    const expected = planTransportMission({
      origin: candidate.origin,
      destination: candidate.destination,
      quantity: 2,
      cargo: { alloy: 1000, heliox: 500, aether: 200 },
      fleetSpeed: 1,
    });
    const [mission, originAfter, destinationAfter, transporters] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } }),
      prisma.planet.findUniqueOrThrow({ where: { id: candidate.destination.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } }),
    ]);

    expect(accepted).toMatchObject({
      originPlanetId: candidate.origin.id,
      destinationPlanetId: candidate.destination.id,
      ships: { transporter: 2 },
      cargo: expected.cargo,
      capacity: expected.cargoCapacity,
      totalReservedFuelHeliox: expected.totalReservedFuelHeliox,
      outboundDurationSeconds: expected.outboundDurationSeconds,
      returnDurationSeconds: expected.returnDurationSeconds,
      phase: 'OUTBOUND',
    });
    expect(accepted.arrivesAt.getTime() - accepted.departedAt.getTime()).toBe(expected.outboundDurationSeconds * 1_000);
    expect(accepted.returnsAt.getTime() - accepted.arrivesAt.getTime()).toBe(expected.returnDurationSeconds * 1_000);
    expect(mission).toMatchObject({
      missionType: 'TRANSPORT',
      status: 'OUTBOUND',
      speedPercent: 100,
      jobId: null,
      transportOriginId: candidate.origin.id,
      transportDestinationId: candidate.destination.id,
      transportShips: expected.ships,
      transportCargo: expected.cargo,
      transportRemainingCargo: expected.cargo,
      transportCapacity: expected.cargoCapacity,
      transportOutboundFuelHeliox: expected.outboundFuelHeliox,
      transportReturnFuelHeliox: expected.returnFuelHeliox,
      transportTotalReservedFuelHeliox: expected.totalReservedFuelHeliox,
      transportOutboundDurationSeconds: expected.outboundDurationSeconds,
      transportReturnDurationSeconds: expected.returnDurationSeconds,
      transportPhase: 'OUTBOUND',
    });
    expect(transporters.count).toBe(3);
    expect(originAfter).toMatchObject({
      alloy: beforeOrigin.alloy - expected.cargo.alloy,
      heliox: beforeOrigin.heliox - expected.cargo.heliox - expected.totalReservedFuelHeliox,
      aether: beforeOrigin.aether - expected.cargo.aether,
    });
    expect(destinationAfter).toMatchObject({
      alloy: beforeDestination.alloy,
      heliox: beforeDestination.heliox,
      aether: beforeDestination.aether,
    });
    expect(await prisma.ship.count({ where: { planetId: candidate.destination.id } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
    addJob.mockRestore();
  });

  it('rejects invalid planner inputs, capacity overflow, ownership, and identical planets without side effects', async () => {
    const candidate = await fixture();
    const other = await createPlayer('transport-other');
    const unowned = await createPlanet(other.id, 'Unowned destination');
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const beforeShips = await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } });

    await expectServiceError(launchCanonicalTransport({ ...input(candidate), transporterQuantity: 0 }), 'INVALID_TRANSPORT_INPUT');
    await expectServiceError(launchCanonicalTransport({ ...input(candidate), transporterQuantity: 1, cargo: { alloy: 4001, heliox: 0, aether: 0 } }), 'INVALID_TRANSPORT_INPUT');
    await expectServiceError(launchCanonicalTransport({ ...input(candidate), destinationPlanetId: unowned.id }), 'DESTINATION_NOT_OWNED');
    await expectServiceError(launchCanonicalTransport({ ...input(candidate), destinationPlanetId: candidate.origin.id }), 'IDENTICAL_PLANETS');
    await expectServiceError(launchCanonicalTransport({ ...input(candidate), speedPercent: 1 } as unknown as TransportLaunchInput), 'INVALID_TRANSPORT_INPUT');

    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({
      alloy: beforeOrigin.alloy,
      heliox: beforeOrigin.heliox,
      aether: beforeOrigin.aether,
    });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } })).toMatchObject({ count: beforeShips.count });
  });

  it('rejects insufficient Transporters, cargo resources, and Heliox including return fuel without mutations', async () => {
    const noShips = await fixture({ transporters: 1 });
    await expectServiceError(launchCanonicalTransport(input(noShips, { transporterQuantity: 2 })), 'INSUFFICIENT_TRANSPORTERS');

    const noCargo = await fixture({ originResources: { alloy: 999 } });
    await expectServiceError(launchCanonicalTransport(input(noCargo)), 'INSUFFICIENT_RESOURCES');

    const candidate = await fixture();
    const expected = planTransportMission({
      origin: candidate.origin,
      destination: candidate.destination,
      quantity: 2,
      cargo: { alloy: 1000, heliox: 500, aether: 200 },
      fleetSpeed: 1,
    });
    await prisma.planet.update({
      where: { id: candidate.origin.id },
      data: { heliox: expected.cargo.heliox + expected.totalReservedFuelHeliox - 1 },
    });
    await expectServiceError(launchCanonicalTransport(input(candidate)), 'INSUFFICIENT_HELIOX');

    expect(await prisma.fleetMission.count()).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: noShips.origin.id, key: 'transporter' } } })).toMatchObject({ count: 1 });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } })).toMatchObject({ count: 5 });
  });

  it('rejects an active canonical transport before new reservation', async () => {
    const candidate = await fixture();
    await canonicalTransport(candidate.origin.id, candidate.destination.id);
    const beforeOrigin = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });

    await expectServiceError(launchCanonicalTransport(input(candidate)), 'TRANSPORT_IN_PROGRESS');
    expect(await prisma.fleetMission.count({ where: { transportOriginId: candidate.origin.id } })).toBe(1);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({ heliox: beforeOrigin.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } })).toMatchObject({ count: 5 });
  });

  it('serializes concurrent launches so exactly one transport reserves ships, cargo, and fuel', async () => {
    const candidate = await fixture({ transporters: 3 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } });
    const attempts = await Promise.allSettled([
      launchCanonicalTransport(input(candidate, { transporterQuantity: 2 })),
      launchCanonicalTransport(input(candidate, { transporterQuantity: 2 })),
    ]);
    const successes = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof launchCanonicalTransport>>> => result.status === 'fulfilled');
    const failures = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({ name: 'TransportLaunchError', code: 'TRANSPORT_IN_PROGRESS' });
    const plan = planTransportMission({
      origin: candidate.origin,
      destination: candidate.destination,
      quantity: 2,
      cargo: { alloy: 1000, heliox: 500, aether: 200 },
      fleetSpeed: 1,
    });
    expect(await prisma.fleetMission.count({ where: { transportOriginId: candidate.origin.id, transportPhase: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: candidate.origin.id, key: 'transporter' } } })).toMatchObject({ count: 1 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: candidate.origin.id } })).toMatchObject({
      alloy: before.alloy - plan.cargo.alloy,
      heliox: before.heliox - plan.cargo.heliox - plan.totalReservedFuelHeliox,
      aether: before.aether - plan.cargo.aether,
    });
  });
});

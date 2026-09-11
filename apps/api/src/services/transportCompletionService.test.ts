import { prisma } from '../lib/prisma';
import { fleetQueue } from '../lib/redis';
import { invalidateUniverseConfigCache } from './gameConfig';
import { settleCanonicalTransport } from './transportCompletionService';
import { launchCanonicalTransport } from './transportLaunchService';

let coordinate = 1;
let fixtureNumber = 0;

beforeEach(() => {
  coordinate = 1;
  fixtureNumber = 0;
  invalidateUniverseConfigCache();
});

afterEach(() => {
  invalidateUniverseConfigCache();
});

async function fixture(options: {
  originTransporters?: number;
  destinationResources?: { alloy: number; heliox: number; aether: number };
} = {}) {
  fixtureNumber += 1;
  const user = await prisma.user.create({
    data: {
      email: `transport-completion-${fixtureNumber}@example.invalid`,
      username: `transport-completion-${fixtureNumber}`,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const origin = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: 'Transport origin',
      galaxy: 4,
      system: 40,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 8_000,
      heliox: 8_000,
      aether: 8_000,
      lastProductionAt: new Date(),
    },
  });
  const destination = await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: 'Transport destination',
      galaxy: 4,
      system: 40,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: options.destinationResources?.alloy ?? 1_000,
      heliox: options.destinationResources?.heliox ?? 1_000,
      aether: options.destinationResources?.aether ?? 1_000,
      lastProductionAt: new Date(),
    },
  });
  await prisma.ship.create({
    data: { planetId: origin.id, key: 'transporter', count: options.originTransporters ?? 5 },
  });
  const accepted = await launchCanonicalTransport({
    userId: user.id,
    originPlanetId: origin.id,
    destinationPlanetId: destination.id,
    transporterQuantity: 2,
    cargo: { alloy: 1_000, heliox: 500, aether: 200 },
  });
  return { user, origin, destination, accepted };
}

async function makeDue(missionId: string) {
  const now = new Date();
  await prisma.fleetMission.update({ where: { id: missionId }, data: { arrivesAt: now } });
  return now;
}

describe('settleCanonicalTransport', () => {
  it('keeps outbound and returning transports unchanged before their persisted due times', async () => {
    const data = await fixture();
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } });
    const destinationBefore = await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } });

    expect(await settleCanonicalTransport(mission.id, new Date(mission.arrivesAt.getTime() - 1))).toBe('early');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } })).toMatchObject({ transportPhase: 'OUTBOUND', status: 'OUTBOUND' });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } })).toMatchObject({
      alloy: destinationBefore.alloy,
      heliox: destinationBefore.heliox,
      aether: destinationBefore.aether,
    });

    const futureReturn = new Date(Date.now() + 60_000);
    await prisma.fleetMission.update({
      where: { id: mission.id },
      data: {
        status: 'RETURNING',
        transportPhase: 'RETURNING',
        transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 },
        returnsAt: futureReturn,
      },
    });
    expect(await settleCanonicalTransport(mission.id, new Date(futureReturn.getTime() - 1))).toBe('early');
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } })).toMatchObject({ count: 3 });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('delivers due cargo once, transitions to RETURNING, and keeps Transporters reserved until return', async () => {
    const data = await fixture();
    const due = await makeDue(data.accepted.missionId);
    const beforeDestination = await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } });
    const addJob = jest.spyOn(fleetQueue, 'add');

    expect(await settleCanonicalTransport(data.accepted.missionId, due)).toBe('delivered');
    const [mission, destination, transporters] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } }),
    ]);
    expect(mission).toMatchObject({
      status: 'RETURNING',
      transportPhase: 'RETURNING',
      transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 },
    });
    expect(mission.returnsAt!.getTime() - due.getTime()).toBe(mission.transportReturnDurationSeconds! * 1_000);
    expect(destination).toMatchObject({
      alloy: beforeDestination.alloy + 1_000,
      heliox: beforeDestination.heliox + 500,
      aether: beforeDestination.aether + 200,
    });
    expect(transporters.count).toBe(3);
    expect(await prisma.ship.count({ where: { planetId: data.destination.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
    expect(await prisma.combatReport.count()).toBe(0);
    expect(await prisma.espionageReport.count()).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
    addJob.mockRestore();
  });

  it('waits at full storage without partial delivery, then delivers the original cargo once capacity is available', async () => {
    const data = await fixture({ destinationResources: { alloy: 10_000, heliox: 10_000, aether: 10_000 } });
    const due = await makeDue(data.accepted.missionId);

    expect(await settleCanonicalTransport(data.accepted.missionId, due)).toBe('awaiting-capacity');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } })).toMatchObject({
      status: 'OUTBOUND',
      transportPhase: 'AWAITING_DESTINATION_CAPACITY',
      transportRemainingCargo: { alloy: 1_000, heliox: 500, aether: 200 },
    });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } })).toMatchObject({ alloy: 10_000, heliox: 10_000, aether: 10_000 });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } })).toMatchObject({ count: 3 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_AWAITING_CAPACITY' } })).toBe(1);

    const capacityAvailableAt = new Date(due.getTime() + 60_000);
    await prisma.planet.update({
      where: { id: data.destination.id },
      data: { alloy: 8_000, heliox: 8_000, aether: 8_000, lastProductionAt: capacityAvailableAt },
    });
    expect(await settleCanonicalTransport(data.accepted.missionId, capacityAvailableAt)).toBe('delivered');
    const [mission, destination] = await Promise.all([
      prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } }),
      prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } }),
    ]);
    expect(mission).toMatchObject({ status: 'RETURNING', transportPhase: 'RETURNING', transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 } });
    expect(mission.returnsAt!.getTime() - capacityAvailableAt.getTime()).toBe(mission.transportReturnDurationSeconds! * 1_000);
    expect(destination).toMatchObject({ alloy: 9_000, heliox: 8_500, aether: 8_200 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_AWAITING_CAPACITY' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
  });

  it('restores exactly the accepted Transporter quantity once on a due return, including a missing origin inventory row', async () => {
    const data = await fixture();
    const due = await makeDue(data.accepted.missionId);
    expect(await settleCanonicalTransport(data.accepted.missionId, due)).toBe('delivered');
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } });
    await prisma.ship.delete({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } });

    expect(await settleCanonicalTransport(mission.id, mission.returnsAt!)).toBe('returned');
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } })).toMatchObject({ status: 'COMPLETE', transportPhase: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_RETURNED' } })).toBe(1);
  });

  it('makes duplicate and concurrent delivery and return calls exactly once', async () => {
    const data = await fixture();
    const due = await makeDue(data.accepted.missionId);
    const deliveryOutcomes = await Promise.all([
      settleCanonicalTransport(data.accepted.missionId, due),
      settleCanonicalTransport(data.accepted.missionId, due),
      settleCanonicalTransport(data.accepted.missionId, due),
    ]);
    expect(deliveryOutcomes.filter((outcome) => outcome === 'delivered')).toHaveLength(1);
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: data.accepted.missionId } });
    const returnOutcomes = await Promise.all([
      settleCanonicalTransport(data.accepted.missionId, mission.returnsAt!),
      settleCanonicalTransport(data.accepted.missionId, mission.returnsAt!),
      settleCanonicalTransport(data.accepted.missionId, mission.returnsAt!),
    ]);
    expect(returnOutcomes.filter((outcome) => outcome === 'returned')).toHaveLength(1);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.destination.id } })).toMatchObject({ alloy: 2_000, heliox: 1_500, aether: 1_200 });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'transporter' } } })).toMatchObject({ count: 5 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_DELIVERED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'TRANSPORT_RETURNED' } })).toBe(1);
  });

  it('leaves legacy, malformed, and terminal transport rows untouched', async () => {
    const legacy = await fixture();
    const legacyMission = await prisma.fleetMission.create({
      data: {
        originId: legacy.origin.id,
        targetId: legacy.destination.id,
        targetGalaxy: legacy.destination.galaxy,
        targetSystem: legacy.destination.system,
        targetSlot: legacy.destination.slot,
        missionType: 'TRANSPORT',
        ships: { transporter: 99 },
        cargo: { alloy: 99 },
        arrivesAt: new Date(),
      },
    });
    const malformed = await fixture();
    await prisma.fleetMission.update({
      where: { id: malformed.accepted.missionId },
      data: { status: 'COMPLETE', transportPhase: 'COMPLETE' },
    });
    const malformedMission = await prisma.fleetMission.create({
      data: {
        originId: malformed.origin.id,
        targetId: malformed.destination.id,
        targetGalaxy: malformed.destination.galaxy,
        targetSystem: malformed.destination.system,
        targetSlot: malformed.destination.slot,
        missionType: 'TRANSPORT',
        ships: { transporter: 99 },
        cargo: { alloy: 99 },
        arrivesAt: new Date(),
        transportOriginId: malformed.origin.id,
        transportDestinationId: malformed.destination.id,
        transportShips: { transporter: 0 },
        transportCargo: { alloy: 1, heliox: 0, aether: 0 },
        transportRemainingCargo: { alloy: 1, heliox: 0, aether: 0 },
        transportCapacity: 1,
        transportOutboundFuelHeliox: 1,
        transportReturnFuelHeliox: 1,
        transportTotalReservedFuelHeliox: 2,
        transportOutboundDurationSeconds: 1,
        transportReturnDurationSeconds: 1,
        transportPhase: 'OUTBOUND',
      },
    });
    const terminal = await fixture();
    const terminalMission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: terminal.accepted.missionId } });
    await prisma.fleetMission.update({ where: { id: terminalMission.id }, data: { status: 'COMPLETE', transportPhase: 'COMPLETE' } });

    await expect(settleCanonicalTransport(legacyMission.id, new Date())).resolves.toBe('noop');
    await expect(settleCanonicalTransport(malformedMission.id, new Date())).resolves.toBe('noop');
    await expect(settleCanonicalTransport(terminalMission.id, new Date())).resolves.toBe('noop');
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.ship.count({ where: { planetId: { in: [legacy.destination.id, malformed.destination.id, terminal.destination.id] } } })).toBe(0);
  });
});

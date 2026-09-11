import { Prisma, TransportMissionPhase } from '@prisma/client';
import { prisma } from '../lib/prisma';

let nextSlot = 1;

async function player(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}@example.invalid`,
      username: label,
      passwordHash: 'not-used',
      status: 'ACTIVE',
    },
  });
}

async function planet(ownerId: string, label: string) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: label,
      galaxy: 7,
      system: 90,
      slot: nextSlot++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function transportMission(options: {
  originId: string;
  destinationId: string;
  phase?: TransportMissionPhase;
  canonical?: boolean;
}) {
  const canonical = options.canonical ?? true;
  return prisma.fleetMission.create({
    data: {
      originId: options.originId,
      targetId: options.destinationId,
      targetGalaxy: 7,
      targetSystem: 90,
      targetSlot: 12,
      missionType: 'TRANSPORT',
      ships: { legacy: 'ignored' },
      cargo: { legacy: 'ignored' },
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      returnsAt: new Date('2026-12-01T00:10:00.000Z'),
      ...(canonical ? {
        transportOriginId: options.originId,
        transportDestinationId: options.destinationId,
        transportShips: { transporter: 2 },
        transportCargo: { alloy: 100, heliox: 50, aether: 0 },
        transportRemainingCargo: { alloy: 100, heliox: 50, aether: 0 },
        transportCapacity: 8000,
        transportOutboundFuelHeliox: 10,
        transportReturnFuelHeliox: 10,
        transportTotalReservedFuelHeliox: 20,
        transportOutboundDurationSeconds: 60,
        transportReturnDurationSeconds: 60,
        transportPhase: options.phase ?? 'OUTBOUND',
      } : {}),
    },
  });
}

beforeEach(() => {
  nextSlot = 1;
});

describe('canonical transport persistence', () => {
  it('keeps legacy rows null while persisting canonical snapshots and reusing unambiguous travel timestamps', async () => {
    const account = await player('transport-persistence');
    const origin = await planet(account.id, 'Origin');
    const destination = await planet(account.id, 'Destination');

    const legacy = await transportMission({ originId: origin.id, destinationId: destination.id, canonical: false });
    expect(legacy).toMatchObject({
      transportOriginId: null,
      transportDestinationId: null,
      transportShips: null,
      transportCargo: null,
      transportRemainingCargo: null,
      transportCapacity: null,
      transportOutboundFuelHeliox: null,
      transportReturnFuelHeliox: null,
      transportTotalReservedFuelHeliox: null,
      transportOutboundDurationSeconds: null,
      transportReturnDurationSeconds: null,
      transportPhase: null,
      ships: { legacy: 'ignored' },
      cargo: { legacy: 'ignored' },
    });

    const canonical = await transportMission({ originId: origin.id, destinationId: destination.id });
    expect(canonical).toMatchObject({
      transportOriginId: origin.id,
      transportDestinationId: destination.id,
      transportShips: { transporter: 2 },
      transportCargo: { alloy: 100, heliox: 50, aether: 0 },
      transportRemainingCargo: { alloy: 100, heliox: 50, aether: 0 },
      transportCapacity: 8000,
      transportOutboundFuelHeliox: 10,
      transportReturnFuelHeliox: 10,
      transportTotalReservedFuelHeliox: 20,
      transportOutboundDurationSeconds: 60,
      transportReturnDurationSeconds: 60,
      transportPhase: 'OUTBOUND',
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      returnsAt: new Date('2026-12-01T00:10:00.000Z'),
    });
  });

  it('enforces one active canonical transport per origin while allowing another origin and terminal rows', async () => {
    const account = await player('transport-active');
    const firstOrigin = await planet(account.id, 'First origin');
    const secondOrigin = await planet(account.id, 'Second origin');
    const firstDestination = await planet(account.id, 'First destination');
    const secondDestination = await planet(account.id, 'Second destination');

    await transportMission({ originId: firstOrigin.id, destinationId: firstDestination.id });
    await expect(transportMission({
      originId: firstOrigin.id,
      destinationId: secondDestination.id,
      phase: 'AWAITING_DESTINATION_CAPACITY',
    })).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);

    await expect(transportMission({
      originId: secondOrigin.id,
      destinationId: firstDestination.id,
      phase: 'RETURNING',
    })).resolves.toMatchObject({ transportPhase: 'RETURNING' });
    await expect(transportMission({
      originId: firstOrigin.id,
      destinationId: secondDestination.id,
      phase: 'COMPLETE',
    })).resolves.toMatchObject({ transportPhase: 'COMPLETE' });
  });

  it('creates the required canonical foreign keys and lookup indexes', async () => {
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT "conname" FROM "pg_constraint"
      WHERE "conname" IN ('FleetMission_transportOriginId_fkey', 'FleetMission_transportDestinationId_fkey')
    `;
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "schemaname" = 'public'
        AND "tablename" = 'FleetMission'
        AND "indexname" IN (
          'FleetMission_transportOriginId_transportPhase_idx',
          'FleetMission_transportDestinationId_idx',
          'FleetMission_one_active_canonical_transport_per_origin'
        )
    `;

    expect(constraints.map((constraint) => constraint.conname).sort()).toEqual([
      'FleetMission_transportDestinationId_fkey',
      'FleetMission_transportOriginId_fkey',
    ]);
    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      'FleetMission_one_active_canonical_transport_per_origin',
      'FleetMission_transportDestinationId_idx',
      'FleetMission_transportOriginId_transportPhase_idx',
    ]);
  });
});

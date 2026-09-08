import { Prisma } from '@prisma/client';
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
      galaxy: 6,
      system: 80,
      slot: nextSlot++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
    },
  });
}

async function colonizationMission(options: {
  accountId: string;
  originId: string;
  target: { galaxy: number; system: number; slot: number };
  canonical?: boolean;
}) {
  const canonical = options.canonical ?? true;
  return prisma.fleetMission.create({
    data: {
      originId: options.originId,
      targetGalaxy: options.target.galaxy,
      targetSystem: options.target.system,
      targetSlot: options.target.slot,
      missionType: 'COLONIZE',
      ships: { colonyShip: 1 },
      cargo: { alloy: 0, heliox: 0, aether: 0 },
      arrivesAt: new Date('2026-12-01T00:00:00.000Z'),
      ...(canonical ? {
        colonizationAccountId: options.accountId,
        colonizationTargetGalaxy: options.target.galaxy,
        colonizationTargetSystem: options.target.system,
        colonizationTargetSlot: options.target.slot,
        colonizationShips: { colonyShip: 1 },
        colonizationFuelHeliox: 10,
        colonizationDurationSeconds: 60,
        colonizationCharacteristics: { planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7, fieldCapacity: 180 },
        colonizationStarterState: { resources: { alloy: 500, heliox: 300, aether: 0 }, buildings: { solarArray: 1, alloyMine: 0, helioxExtractor: 0 } },
      } : {}),
    },
  });
}

beforeEach(() => {
  nextSlot = 1;
});

describe('canonical colonisation reservation persistence', () => {
  it('keeps legacy rows nullable while PostgreSQL enforces canonical account and coordinate reservations', async () => {
    const firstAccount = await player('colonization-first');
    const secondAccount = await player('colonization-second');
    const firstOrigin = await planet(firstAccount.id, 'First origin');
    const secondOrigin = await planet(secondAccount.id, 'Second origin');
    const target = { galaxy: 2, system: 30, slot: 4 };

    const legacy = await colonizationMission({ accountId: firstAccount.id, originId: firstOrigin.id, target, canonical: false });
    expect(legacy).toMatchObject({
      colonizationAccountId: null,
      colonizationTargetGalaxy: null,
      colonizationTargetSystem: null,
      colonizationTargetSlot: null,
      colonizationShips: null,
      colonizationCharacteristics: null,
      colonizationStarterState: null,
      createdPlanetId: null,
    });

    await colonizationMission({ accountId: firstAccount.id, originId: firstOrigin.id, target });

    await expect(colonizationMission({
      accountId: firstAccount.id,
      originId: firstOrigin.id,
      target: { galaxy: 2, system: 30, slot: 5 },
    })).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);

    await expect(colonizationMission({
      accountId: secondAccount.id,
      originId: secondOrigin.id,
      target,
    })).rejects.toMatchObject({ code: 'P2002' } as Partial<Prisma.PrismaClientKnownRequestError>);

    await expect(colonizationMission({
      accountId: secondAccount.id,
      originId: secondOrigin.id,
      target: { galaxy: 2, system: 30, slot: 6 },
    })).resolves.toMatchObject({ status: 'OUTBOUND' });
    await expect(colonizationMission({
      accountId: firstAccount.id,
      originId: firstOrigin.id,
      target,
      canonical: false,
    })).resolves.toMatchObject({ colonizationAccountId: null });
  });
});

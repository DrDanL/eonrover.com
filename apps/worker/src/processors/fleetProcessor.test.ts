import { Job } from 'bullmq';
import { prisma } from '../prisma';
import { processFleetJob } from './fleetProcessor';

async function createUser(email: string, username: string) {
  return prisma.user.create({
    data: {
      email,
      username,
      passwordHash: 'x',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
}

async function createPlanet(ownerId: string, galaxy: number, system: number, slot: number, overrides: Partial<{ alloy: number; heliox: number; aether: number }> = {}) {
  return prisma.planet.create({
    data: {
      ownerId,
      name: 'Test Planet',
      galaxy,
      system,
      slot,
      planetType: 'TEMPERATE',
      temperature: 15,
      solarIndex: 1,
      alloy: overrides.alloy ?? 1000,
      heliox: overrides.heliox ?? 1000,
      aether: overrides.aether ?? 0,
    },
  });
}

function fakeJob(missionId: string, name: string): Job<{ missionId: string }> {
  return { data: { missionId }, name } as Job<{ missionId: string }>;
}

describe('fleetProcessor', () => {
  it('TRANSPORT delivers cargo to the target planet and schedules the return leg', async () => {
    const attacker = await createUser('transporter@example.com', 'transporter');
    const defender = await createUser('receiver@example.com', 'receiver');
    const origin = await createPlanet(attacker.id, 1, 1, 1);
    const target = await createPlanet(defender.id, 1, 1, 2);

    const mission = await prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target.id,
        targetGalaxy: target.galaxy,
        targetSystem: target.system,
        targetSlot: target.slot,
        missionType: 'TRANSPORT',
        ships: { transporter: 1 },
        cargo: { alloy: 100, heliox: 0, aether: 0 },
        arrivesAt: new Date(),
      },
    });

    await processFleetJob(fakeJob(mission.id, 'fleet-arrive'));

    const updatedTarget = await prisma.planet.findUniqueOrThrow({ where: { id: target.id } });
    expect(updatedTarget.alloy).toBe(1100);

    const updatedMission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(updatedMission.status).toBe('RETURNING');
    expect(updatedMission.returnsAt).not.toBeNull();
  });

  it('ATTACK with overwhelming force destroys the defender fleet and creates a combat report', async () => {
    const attacker = await createUser('raider@example.com', 'raider');
    const defender = await createUser('victim@example.com', 'victim');
    const origin = await createPlanet(attacker.id, 2, 1, 1);
    const target = await createPlanet(defender.id, 2, 1, 2, { alloy: 5000, heliox: 5000 });
    await prisma.ship.create({ data: { planetId: target.id, key: 'scout', count: 1 } });

    const mission = await prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target.id,
        targetGalaxy: target.galaxy,
        targetSystem: target.system,
        targetSlot: target.slot,
        missionType: 'ATTACK',
        ships: { frigate: 20 },
        cargo: { alloy: 0, heliox: 0, aether: 0 },
        arrivesAt: new Date(),
      },
    });

    await processFleetJob(fakeJob(mission.id, 'fleet-arrive'));

    const report = await prisma.combatReport.findFirstOrThrow({ where: { missionId: mission.id } });
    expect(report.outcome).toBe('attacker');

    const survivingDefenderShips = await prisma.ship.findUnique({
      where: { planetId_key: { planetId: target.id, key: 'scout' } },
    });
    expect(survivingDefenderShips?.count ?? 0).toBe(0);

    const updatedMission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(updatedMission.status).toBe('RETURNING');
  });

  it('COLONIZE founds a new planet at an empty target slot', async () => {
    const colonizer = await createUser('colonizer@example.com', 'colonizer');
    const origin = await createPlanet(colonizer.id, 3, 1, 1);

    const mission = await prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: null,
        targetGalaxy: 3,
        targetSystem: 1,
        targetSlot: 5,
        missionType: 'COLONIZE',
        ships: { colonyShip: 1 },
        cargo: { alloy: 0, heliox: 0, aether: 0 },
        arrivesAt: new Date(),
      },
    });

    await processFleetJob(fakeJob(mission.id, 'fleet-arrive'));

    const newPlanet = await prisma.planet.findUnique({ where: { galaxy_system_slot: { galaxy: 3, system: 1, slot: 5 } } });
    expect(newPlanet).not.toBeNull();
    expect(newPlanet?.ownerId).toBe(colonizer.id);

    const updatedMission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(updatedMission.status).toBe('COMPLETE');
  });

  it('GATE_TRAVEL deposits the fleet at the target planet instantly with no return leg', async () => {
    const traveler = await createUser('traveler@example.com', 'traveler');
    const origin = await createPlanet(traveler.id, 4, 1, 1);
    const target = await createPlanet(traveler.id, 4, 2, 1);

    const mission = await prisma.fleetMission.create({
      data: {
        originId: origin.id,
        targetId: target.id,
        targetGalaxy: target.galaxy,
        targetSystem: target.system,
        targetSlot: target.slot,
        missionType: 'GATE_TRAVEL',
        ships: { frigate: 2 },
        cargo: { alloy: 50, heliox: 0, aether: 0 },
        arrivesAt: new Date(),
      },
    });

    await processFleetJob(fakeJob(mission.id, 'fleet-arrive'));

    const ships = await prisma.ship.findUnique({ where: { planetId_key: { planetId: target.id, key: 'frigate' } } });
    expect(ships?.count).toBe(2);

    const updatedTarget = await prisma.planet.findUniqueOrThrow({ where: { id: target.id } });
    expect(updatedTarget.alloy).toBe(1050);

    const updatedMission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: mission.id } });
    expect(updatedMission.status).toBe('COMPLETE');
  });
});

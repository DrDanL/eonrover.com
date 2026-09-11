import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { COLONY_STARTER_STATE, deriveColonyCharacteristics } from '@eonrover/shared';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { colonizationArrivalQueue } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { colonizationArrivalJobId } from '../services/colonizationArrivalSchedulingService';
import { launchCanonicalColonization } from '../services/colonizationLaunchService';

const app = createApp();
let fixture = 0;
let coordinate = 1;
let playerNumber = 0;

beforeEach(() => { fixture += 1; coordinate = 1; playerNumber = 0; });

async function createPlayer(label: string) {
  const id = `${label}-${fixture}-${++playerNumber}`;
  const user = await prisma.user.create({ data: {
    email: `${id}@example.invalid`, username: id, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const token = `fleet-colonization-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createPlanet(ownerId: string, name: string, options: {
  galaxy?: number; system?: number; slot?: number; heliox?: number; colonyShips?: number;
} = {}) {
  const planet = await prisma.planet.create({ data: {
    ownerId, name, galaxy: options.galaxy ?? 30, system: options.system ?? fixture * 100 + coordinate++,
    slot: options.slot ?? 1, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 2_000, heliox: options.heliox ?? 5_000, aether: 500, lastProductionAt: new Date(),
  } });
  if (options.colonyShips !== undefined) {
    await prisma.ship.create({ data: { planetId: planet.id, key: 'colonyShip', count: options.colonyShips } });
  }
  return planet;
}

async function ownerFixture(options: { heliox?: number; colonyShips?: number } = {}) {
  const account = await createPlayer('colonization-owner');
  const origin = await createPlanet(account.user.id, 'Colonization Origin', options);
  return { ...account, origin };
}

function colonizationPath(originPlanetId: string) {
  return `/api/fleet/colonizations?originPlanetId=${originPlanetId}`;
}

function starterState() {
  return {
    fieldCapacity: COLONY_STARTER_STATE.fieldCapacity,
    resources: { ...COLONY_STARTER_STATE.resources },
    buildings: { ...COLONY_STARTER_STATE.buildings },
  };
}

async function createCanonicalReservation(options: {
  accountId: string;
  origin: Awaited<ReturnType<typeof createPlanet>>;
  targetSlot: number;
  arrivesAt?: Date;
}) {
  const id = randomUUID();
  const arrivesAt = options.arrivesAt ?? new Date(Date.now() + 60_000);
  return prisma.fleetMission.create({ data: {
    id,
    originId: options.origin.id,
    targetGalaxy: options.origin.galaxy,
    targetSystem: options.origin.system,
    targetSlot: options.targetSlot,
    missionType: 'COLONIZE', ships: { colonyShip: 1 }, cargo: { alloy: 0, heliox: 0, aether: 0 }, speedPercent: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000), arrivesAt, status: 'OUTBOUND',
    colonizationAccountId: options.accountId,
    colonizationTargetGalaxy: options.origin.galaxy,
    colonizationTargetSystem: options.origin.system,
    colonizationTargetSlot: options.targetSlot,
    colonizationShips: { colonyShip: 1 },
    colonizationFuelHeliox: 10,
    colonizationDurationSeconds: 60,
    colonizationCharacteristics: deriveColonyCharacteristics(id),
    colonizationStarterState: starterState(),
  } });
}

async function removeWakeup(missionId: string) {
  const job = await colonizationArrivalQueue.getJob(colonizationArrivalJobId(missionId));
  await job?.remove();
}

describe('owned-planet colonisation API', () => {
  it('requires authentication and CSRF, enforces origin ownership, and leaves legacy Fleet routes unavailable', async () => {
    const owner = await ownerFixture({ colonyShips: 1 });
    const other = await ownerFixture({ colonyShips: 1 });

    await request(app).get(colonizationPath(owner.origin.id)).expect(401);
    await request(app)
      .post('/api/fleet/colonizations')
      .set('Cookie', owner.cookie)
      .send({ originPlanetId: owner.origin.id, targetSlot: 4 })
      .expect(403);
    await request(app).get(colonizationPath(other.origin.id)).set('Cookie', owner.cookie).expect(404);
    await request(app)
      .post('/api/fleet/colonizations')
      .set('Cookie', owner.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: other.origin.id, targetSlot: 4 })
      .expect(404);
    await request(app).get('/api/fleet').set('Cookie', owner.cookie).expect(503, {
      error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE',
    });
    expect(await prisma.fleetMission.count()).toBe(0);
  });

  it('returns authoritative origin state, available same-system slots, and excludes occupied or reserved slots without exposing owners', async () => {
    const owner = await ownerFixture({ heliox: 777, colonyShips: 2 });
    const occupiedOwner = await createPlayer('occupied-owner');
    const reservingOwner = await createPlayer('reserving-owner');
    await createPlanet(occupiedOwner.user.id, 'Occupied', { galaxy: owner.origin.galaxy, system: owner.origin.system, slot: 4 });
    const reservingOrigin = await createPlanet(reservingOwner.user.id, 'Reserving origin', {
      galaxy: owner.origin.galaxy, system: owner.origin.system, slot: 2,
    });
    const reservation = await createCanonicalReservation({ accountId: reservingOwner.user.id, origin: reservingOrigin, targetSlot: 5 });

    const response = await request(app).get(colonizationPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200);
    expect(response.body).toEqual({
      selectedOrigin: {
        id: owner.origin.id,
        name: owner.origin.name,
        coordinates: { galaxy: owner.origin.galaxy, system: owner.origin.system, slot: owner.origin.slot },
        heliox: 777,
        availableColonyShips: 2,
      },
      availableTargetSlots: [3, 6, 7, 8, 9, 10, 11, 12],
      activeColonization: null,
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(occupiedOwner.user.id);
    expect(serialized).not.toContain(reservingOwner.user.id);
    expect(serialized).not.toContain(reservation.id);
    expect(serialized).not.toMatch(/jobId|colonizationShips|starterState|characteristics|cargo/i);
  });

  it('presents only an account-wide canonical active colonisation with safe display fields', async () => {
    const owner = await ownerFixture({ colonyShips: 1 });
    const otherOrigin = await createPlanet(owner.user.id, 'Second Origin', {
      galaxy: owner.origin.galaxy, system: owner.origin.system, slot: 2,
    });
    const mission = await createCanonicalReservation({ accountId: owner.user.id, origin: otherOrigin, targetSlot: 4 });

    const response = await request(app).get(colonizationPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200);
    expect(response.body.activeColonization).toEqual({
      origin: {
        id: otherOrigin.id,
        name: otherOrigin.name,
        coordinates: { galaxy: otherOrigin.galaxy, system: otherOrigin.system, slot: otherOrigin.slot },
      },
      target: { coordinates: { galaxy: otherOrigin.galaxy, system: otherOrigin.system, slot: 4 } },
      status: 'OUTBOUND',
      departedAt: mission.departedAt.toISOString(),
      arrivesAt: mission.arrivesAt.toISOString(),
      durationSeconds: 60,
    });
    const serialized = JSON.stringify(response.body.activeColonization);
    expect(response.body.activeColonization).not.toHaveProperty('id');
    for (const internal of ['jobId', 'colonizationShips', 'fuel', 'starter', 'characteristics', 'cargo', 'resultSummary']) {
      expect(serialized).not.toContain(internal);
    }
  });

  it('settles a due canonical colonisation once before the command summary is returned', async () => {
    const owner = await ownerFixture({ colonyShips: 1 });
    const accepted = await launchCanonicalColonization({ accountId: owner.user.id, originPlanetId: owner.origin.id, targetSlot: 4 });
    const due = new Date(Date.now() - 1_000);
    try {
      await prisma.fleetMission.update({
        where: { id: accepted.missionId },
        data: { arrivesAt: due, departedAt: new Date(due.getTime() - accepted.durationSeconds * 1_000) },
      });
      const [first, second] = await Promise.all([
        request(app).get(colonizationPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200),
        request(app).get(colonizationPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200),
      ]);
      expect(first.body.activeColonization).toBeNull();
      expect(second.body.activeColonization).toBeNull();
      expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'COMPLETE' });
      expect(await prisma.planet.count({ where: { ownerId: owner.user.id } })).toBe(2);
      expect(await prisma.notification.count({ where: { userId: owner.user.id, type: 'COLONY_FOUNDED' } })).toBe(1);
    } finally {
      await removeWakeup(accepted.missionId);
    }
  });

  it('launches with only origin and slot, returns a safe accepted summary, and rejects spoofed client fields without side effects', async () => {
    const owner = await ownerFixture({ colonyShips: 1 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.origin.id } });
    const accepted = await request(app)
      .post('/api/fleet/colonizations')
      .set('Cookie', owner.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: owner.origin.id, targetSlot: 4 })
      .expect(201);
    expect(accepted.body.activeColonization).toMatchObject({
      origin: { id: owner.origin.id }, target: { coordinates: { galaxy: owner.origin.galaxy, system: owner.origin.system, slot: 4 } }, status: 'OUTBOUND',
    });
    expect(Object.keys(accepted.body.activeColonization).sort()).toEqual(['arrivesAt', 'departedAt', 'durationSeconds', 'origin', 'status', 'target']);
    expect(JSON.stringify(accepted.body)).not.toMatch(/jobId|scheduling|fuelHeliox|colonizationShips|cargo|characteristics|starterState/i);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { originId: owner.origin.id } });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 0 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.origin.id } })).toMatchObject({ heliox: before.heliox - mission.colonizationFuelHeliox! });
    await removeWakeup(mission.id);

    const spoofed = await ownerFixture({ colonyShips: 1 });
    const spoofedBefore = await prisma.planet.findUniqueOrThrow({ where: { id: spoofed.origin.id } });
    await request(app)
      .post('/api/fleet/colonizations')
      .set('Cookie', spoofed.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: spoofed.origin.id, targetSlot: 4, ships: { colonyShip: 99 }, cargo: { heliox: 1 }, speed: 1, fuelHeliox: 0, durationSeconds: 1 })
      .expect(400);
    expect(await prisma.fleetMission.count({ where: { originId: spoofed.origin.id } })).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: spoofed.origin.id } })).toMatchObject({ heliox: spoofedBefore.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: spoofed.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
  });

  it('maps invalid, occupied, reserved, active, and insufficient requests without side effects', async () => {
    const invalid = await ownerFixture({ colonyShips: 1 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: invalid.origin.id, targetSlot: invalid.origin.slot }).expect(400);

    const occupied = await ownerFixture({ colonyShips: 1 });
    const occupier = await createPlayer('occupied-launch');
    await createPlanet(occupier.user.id, 'Occupied launch target', { galaxy: occupied.origin.galaxy, system: occupied.origin.system, slot: 4 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', occupied.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: occupied.origin.id, targetSlot: 4 }).expect(409);

    const reserved = await ownerFixture({ colonyShips: 1 });
    const reserver = await createPlayer('reserved-launch');
    const reservingOrigin = await createPlanet(reserver.user.id, 'Reserve target origin', { galaxy: reserved.origin.galaxy, system: reserved.origin.system, slot: 2 });
    await createCanonicalReservation({ accountId: reserver.user.id, origin: reservingOrigin, targetSlot: 4 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', reserved.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: reserved.origin.id, targetSlot: 4 }).expect(409);

    const poorShip = await ownerFixture({ colonyShips: 0 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', poorShip.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: poorShip.origin.id, targetSlot: 4 }).expect(409);
    const poorFuel = await ownerFixture({ colonyShips: 1, heliox: 0 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', poorFuel.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: poorFuel.origin.id, targetSlot: 4 }).expect(402);
    const inProgress = await ownerFixture({ colonyShips: 1 });
    await createCanonicalReservation({ accountId: inProgress.user.id, origin: inProgress.origin, targetSlot: 4 });
    await request(app).post('/api/fleet/colonizations').set('Cookie', inProgress.cookie).set('X-Eonrover-Client', '1').send({ originPlanetId: inProgress.origin.id, targetSlot: 5 }).expect(409);
    expect(await prisma.fleetMission.count({ where: { colonizationAccountId: { in: [invalid.user.id, occupied.user.id, reserved.user.id, poorShip.user.id, poorFuel.user.id] } } })).toBe(0);
    expect(await prisma.fleetMission.count({ where: { colonizationAccountId: inProgress.user.id, status: 'OUTBOUND' } })).toBe(1);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: poorShip.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 0 });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: poorFuel.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 1 });
  });

  it('returns an accepted command when post-commit Redis scheduling fails', async () => {
    const owner = await ownerFixture({ colonyShips: 1 });
    const add = jest.spyOn(colonizationArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app)
        .post('/api/fleet/colonizations')
        .set('Cookie', owner.cookie)
        .set('X-Eonrover-Client', '1')
        .send({ originPlanetId: owner.origin.id, targetSlot: 4 })
        .expect(201);
      expect(response.body.activeColonization).toMatchObject({ origin: { id: owner.origin.id }, status: 'OUTBOUND' });
      expect(JSON.stringify(response.body)).not.toMatch(/scheduling|jobId|Redis/i);
      expect(await prisma.fleetMission.count({ where: { originId: owner.origin.id, status: 'OUTBOUND' } })).toBe(1);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.origin.id, key: 'colonyShip' } } })).toMatchObject({ count: 0 });
    } finally {
      add.mockRestore();
    }
  });
});

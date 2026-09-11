import request from 'supertest';
import { SHIPS } from '@eonrover/shared';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { transportArrivalQueue } from '../lib/redis';
import { transportArrivalJobId, transportReturnJobId } from '../services/transportArrivalSchedulingService';
import { launchCanonicalTransport } from '../services/transportLaunchService';

const app = createApp();
let fixture = 0;
let coordinate = 1;

beforeEach(() => { fixture += 1; coordinate = 1; });

async function createPlayer(label: string) {
  const id = `${label}-${fixture}-${coordinate++}`;
  const user = await prisma.user.create({ data: {
    email: `${id}@example.invalid`, username: id, passwordHash: 'not-used', status: 'ACTIVE', emailVerifiedAt: new Date(),
  } });
  const token = `transport-api-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createPlanet(ownerId: string, name: string, options: {
  alloy?: number; heliox?: number; aether?: number; transporters?: number;
} = {}) {
  const planet = await prisma.planet.create({ data: {
    ownerId, name, galaxy: 41, system: fixture * 100 + coordinate, slot: coordinate++,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: options.alloy ?? 8_000, heliox: options.heliox ?? 8_000, aether: options.aether ?? 8_000,
    lastProductionAt: new Date(),
  } });
  if (options.transporters !== undefined) {
    await prisma.ship.create({ data: { planetId: planet.id, key: 'transporter', count: options.transporters } });
  }
  return planet;
}

async function ownerFixture(options: { alloy?: number; heliox?: number; aether?: number; transporters?: number } = {}) {
  const account = await createPlayer('transport-owner');
  const origin = await createPlanet(account.user.id, 'Transport Origin', options);
  const destination = await createPlanet(account.user.id, 'Transport Destination');
  return { ...account, origin, destination };
}

function transportPath(originPlanetId: string) {
  return `/api/fleet/transports?originPlanetId=${originPlanetId}`;
}

async function removeWakeups(missionId: string) {
  for (const jobId of [transportArrivalJobId(missionId), transportReturnJobId(missionId)]) {
    await (await transportArrivalQueue.getJob(jobId))?.remove();
  }
}

describe('owned-planet transport API', () => {
  it('requires authentication and CSRF, enforces ownership, and leaves generic Fleet routes unavailable', async () => {
    const owner = await ownerFixture({ transporters: 2 });
    const other = await ownerFixture({ transporters: 2 });

    await request(app).get(transportPath(owner.origin.id)).expect(401);
    await request(app)
      .post('/api/fleet/transports')
      .set('Cookie', owner.cookie)
      .send({ originPlanetId: owner.origin.id, destinationPlanetId: owner.destination.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(403);
    await request(app).get(transportPath(other.origin.id)).set('Cookie', owner.cookie).expect(404);
    await request(app)
      .post('/api/fleet/transports')
      .set('Cookie', owner.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: owner.origin.id, destinationPlanetId: other.origin.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(404);
    await request(app).get('/api/fleet').set('Cookie', owner.cookie).expect(503, {
      error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE',
    });
    expect(await prisma.fleetMission.count()).toBe(0);
  });

  it('returns a synchronised, allowlisted command summary with only same-account destinations', async () => {
    const owner = await ownerFixture({ alloy: 777, heliox: 888, aether: 999, transporters: 3 });
    const secondOwned = await createPlanet(owner.user.id, 'Second Owned');
    const other = await createPlayer('transport-foreign');
    const foreign = await createPlanet(other.user.id, 'Foreign');

    const response = await request(app).get(transportPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200);
    expect(response.body).toEqual({
      selectedOrigin: {
        id: owner.origin.id,
        name: owner.origin.name,
        coordinates: { galaxy: owner.origin.galaxy, system: owner.origin.system, slot: owner.origin.slot },
        resources: { alloy: 777, heliox: 888, aether: 999 },
        transporterCount: 3,
      },
      transporterCapacityPerShip: SHIPS.transporter.cargo,
      eligibleDestinations: [{
        id: owner.destination.id,
        name: owner.destination.name,
        coordinates: { galaxy: owner.destination.galaxy, system: owner.destination.system, slot: owner.destination.slot },
      }, {
        id: secondOwned.id,
        name: secondOwned.name,
        coordinates: { galaxy: secondOwned.galaxy, system: secondOwned.system, slot: secondOwned.slot },
      }],
      activeTransport: null,
    });
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [other.user.id, foreign.id, 'jobId', 'scheduling', 'transportCargo', 'transportShips', 'fuelHeliox', 'resultSummary']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('settles due outbound/return work and retries capacity waits before returning an active summary', async () => {
    const owner = await ownerFixture({ transporters: 4 });
    const accepted = await launchCanonicalTransport({
      userId: owner.user.id, originPlanetId: owner.origin.id, destinationPlanetId: owner.destination.id,
      transporterQuantity: 2, cargo: { alloy: 100, heliox: 50, aether: 20 },
    });
    try {
      await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { arrivesAt: new Date(Date.now() - 1_000) } });
      const delivery = await request(app).get(transportPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200);
      expect(delivery.body.activeTransport).toMatchObject({ id: accepted.missionId, phase: 'RETURNING', remainingCargo: { alloy: 0, heliox: 0, aether: 0 }, capacityWaitMessage: null });
      expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.destination.id } })).toMatchObject({ alloy: 8_100, heliox: 8_050, aether: 8_020 });

      const returning = await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } });
      await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { returnsAt: new Date(Date.now() - 1_000) } });
      const returned = await request(app).get(transportPath(owner.origin.id)).set('Cookie', owner.cookie).expect(200);
      expect(returned.body.activeTransport).toBeNull();
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.origin.id, key: 'transporter' } } })).toMatchObject({ count: 4 });
      expect(returning.status).toBe('RETURNING');
    } finally {
      await removeWakeups(accepted.missionId);
    }

    const waiting = await ownerFixture({ transporters: 2 });
    const waitingAccepted = await launchCanonicalTransport({
      userId: waiting.user.id, originPlanetId: waiting.origin.id, destinationPlanetId: waiting.destination.id,
      transporterQuantity: 1, cargo: { alloy: 100, heliox: 50, aether: 20 },
    });
    try {
      await prisma.planet.update({ where: { id: waiting.destination.id }, data: { alloy: 10_000, heliox: 10_000, aether: 10_000 } });
      await prisma.fleetMission.update({ where: { id: waitingAccepted.missionId }, data: { arrivesAt: new Date(Date.now() - 1_000) } });
      const full = await request(app).get(transportPath(waiting.origin.id)).set('Cookie', waiting.cookie).expect(200);
      expect(full.body.activeTransport).toMatchObject({ phase: 'AWAITING_DESTINATION_CAPACITY', remainingCargo: { alloy: 100, heliox: 50, aether: 20 } });
      expect(full.body.activeTransport.capacityWaitMessage).toContain('Waiting for destination storage capacity');

      await prisma.planet.update({ where: { id: waiting.destination.id }, data: { alloy: 0, heliox: 0, aether: 0, lastProductionAt: new Date() } });
      const retried = await request(app).get(transportPath(waiting.origin.id)).set('Cookie', waiting.cookie).expect(200);
      expect(retried.body.activeTransport).toMatchObject({ phase: 'RETURNING', remainingCargo: { alloy: 0, heliox: 0, aether: 0 }, capacityWaitMessage: null });
    } finally {
      await removeWakeups(waitingAccepted.missionId);
    }
  });

  it('launches through the authoritative service and returns only the safe active transport projection', async () => {
    const owner = await ownerFixture({ transporters: 3 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: owner.origin.id } });
    const response = await request(app)
      .post('/api/fleet/transports')
      .set('Cookie', owner.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: owner.origin.id, destinationPlanetId: owner.destination.id, transporterQuantity: 2, cargo: { alloy: 100, heliox: 50, aether: 20 } })
      .expect(201);
    const active = response.body.activeTransport;
    try {
      expect(active).toMatchObject({
        origin: { id: owner.origin.id }, destination: { id: owner.destination.id }, transporterQuantity: 2,
        remainingCargo: { alloy: 100, heliox: 50, aether: 20 }, phase: 'OUTBOUND', capacityWaitMessage: null,
      });
      expect(Object.keys(active).sort()).toEqual(['arrivesAt', 'capacityWaitMessage', 'departedAt', 'destination', 'id', 'origin', 'phase', 'remainingCargo', 'returnsAt', 'transporterQuantity']);
      expect(JSON.stringify(response.body)).not.toMatch(/jobId|scheduling|FuelHeliox|transportCapacity|transportCargo|transportShips|resultSummary/i);
      const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: active.id } });
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.origin.id, key: 'transporter' } } })).toMatchObject({ count: 1 });
      expect(await prisma.planet.findUniqueOrThrow({ where: { id: owner.origin.id } })).toMatchObject({
        alloy: before.alloy - 100,
        heliox: before.heliox - 50 - mission.transportTotalReservedFuelHeliox!,
        aether: before.aether - 20,
      });
    } finally {
      await removeWakeups(active.id);
    }
  });

  it('rejects spoofed, invalid, conflicting, and insufficient requests without side effects', async () => {
    const invalid = await ownerFixture({ transporters: 2 });
    await request(app).post('/api/fleet/transports').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: invalid.origin.id, destinationPlanetId: invalid.destination.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 }, speed: 1 })
      .expect(400);
    await request(app).post('/api/fleet/transports').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: invalid.origin.id, destinationPlanetId: invalid.origin.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(400);
    expect(await prisma.fleetMission.count({ where: { transportOriginId: invalid.origin.id } })).toBe(0);

    const poorShips = await ownerFixture({ transporters: 1 });
    await request(app).post('/api/fleet/transports').set('Cookie', poorShips.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: poorShips.origin.id, destinationPlanetId: poorShips.destination.id, transporterQuantity: 2, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(409);
    const poorHeliox = await ownerFixture({ transporters: 1, heliox: 0 });
    await request(app).post('/api/fleet/transports').set('Cookie', poorHeliox.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: poorHeliox.origin.id, destinationPlanetId: poorHeliox.destination.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(402);
    const overCapacity = await ownerFixture({ transporters: 1 });
    await request(app).post('/api/fleet/transports').set('Cookie', overCapacity.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: overCapacity.origin.id, destinationPlanetId: overCapacity.destination.id, transporterQuantity: 1, cargo: { alloy: SHIPS.transporter.cargo + 1, heliox: 0, aether: 0 } })
      .expect(400);
    expect(await prisma.fleetMission.count({ where: { transportOriginId: { in: [poorShips.origin.id, poorHeliox.origin.id, overCapacity.origin.id] } } })).toBe(0);

    const active = await ownerFixture({ transporters: 2 });
    const accepted = await request(app).post('/api/fleet/transports').set('Cookie', active.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: active.origin.id, destinationPlanetId: active.destination.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
      .expect(201);
    try {
      await request(app).post('/api/fleet/transports').set('Cookie', active.cookie).set('X-Eonrover-Client', '1')
        .send({ originPlanetId: active.origin.id, destinationPlanetId: active.destination.id, transporterQuantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } })
        .expect(409);
      expect(await prisma.fleetMission.count({ where: { transportOriginId: active.origin.id } })).toBe(1);
    } finally {
      await removeWakeups(accepted.body.activeTransport.id);
    }
  });

  it('keeps an accepted launch when post-commit Redis dispatch fails without exposing scheduling details', async () => {
    const owner = await ownerFixture({ transporters: 2 });
    const add = jest.spyOn(transportArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app)
        .post('/api/fleet/transports')
        .set('Cookie', owner.cookie)
        .set('X-Eonrover-Client', '1')
        .send({ originPlanetId: owner.origin.id, destinationPlanetId: owner.destination.id, transporterQuantity: 1, cargo: { alloy: 100, heliox: 50, aether: 20 } })
        .expect(201);
      expect(response.body.activeTransport).toMatchObject({ origin: { id: owner.origin.id }, phase: 'OUTBOUND' });
      expect(JSON.stringify(response.body)).not.toMatch(/scheduling|jobId|Redis/i);
      expect(await prisma.fleetMission.count({ where: { transportOriginId: owner.origin.id, transportPhase: 'OUTBOUND' } })).toBe(1);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: owner.origin.id, key: 'transporter' } } })).toMatchObject({ count: 1 });
    } finally {
      add.mockRestore();
    }
  });
});

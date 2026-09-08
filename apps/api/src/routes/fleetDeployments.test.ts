import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { deployArrivalQueue } from '../lib/redis';
import { launchOwnedPlanetDeploy } from '../services/deployLaunchService';

const app = createApp();
let fixtureNumber = 0;
let coordinate = 1;
let playerNumber = 0;

beforeEach(() => {
  fixtureNumber += 1;
  coordinate = fixtureNumber * 10;
  playerNumber = 0;
});

async function createPlayer(label: string) {
  playerNumber += 1;
  const identifier = `${label}-${fixtureNumber}-${playerNumber}`;
  const user = await prisma.user.create({
    data: {
      email: `${identifier}@example.invalid`,
      username: identifier,
      passwordHash: 'not-used',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const token = `fleet-deploy-${identifier}-${user.id}`;
  await prisma.session.create({
    data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
  });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createPlanet(ownerId: string, name: string, heliox = 5_000) {
  return prisma.planet.create({
    data: {
      ownerId,
      name,
      galaxy: 4,
      system: 4,
      slot: coordinate++,
      planetType: 'TEMPERATE',
      temperature: 10,
      solarIndex: 0.7,
      alloy: 2_000,
      heliox,
      aether: 500,
      lastProductionAt: new Date(),
    },
  });
}

async function ownedFixture(options: { heliox?: number; scouts?: number } = {}) {
  const account = await createPlayer('fleet-owner');
  const origin = await createPlanet(account.user.id, 'Deploy Origin', options.heliox);
  const destination = await createPlanet(account.user.id, 'Deploy Destination');
  await prisma.ship.create({ data: { planetId: origin.id, key: 'scout', count: options.scouts ?? 5 } });
  return { ...account, origin, destination };
}

function deploymentPath(originPlanetId: string) {
  return `/api/fleet/deployments?originPlanetId=${originPlanetId}`;
}

describe('owned-planet deploy API', () => {
  it('requires authentication and CSRF, and does not reveal an unowned origin', async () => {
    const data = await ownedFixture();
    const other = await createPlayer('fleet-other');
    const otherOrigin = await createPlanet(other.user.id, 'Other Origin');

    await request(app).get(deploymentPath(data.origin.id)).expect(401);
    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', data.cookie)
      .send({ originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speed: 100, ships: { scout: 1 } })
      .expect(403);
    await request(app).get(deploymentPath(otherOrigin.id)).set('Cookie', data.cookie).expect(404);
    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', data.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: data.origin.id, destinationPlanetId: otherOrigin.id, speed: 100, ships: { scout: 1 } })
      .expect(404);
    expect(await prisma.fleetMission.count()).toBe(0);
  });

  it('returns only owned destinations and an authoritative allowlisted origin command summary', async () => {
    const data = await ownedFixture({ heliox: 777, scouts: 8 });
    const secondOwned = await createPlanet(data.user.id, 'Second Owned');
    const other = await createPlayer('fleet-unrelated');
    const foreignPlanet = await createPlanet(other.user.id, 'Foreign Planet');
    await prisma.ship.create({ data: { planetId: data.origin.id, key: 'transporter', count: 3 } });

    const response = await request(app).get(deploymentPath(data.origin.id)).set('Cookie', data.cookie).expect(200);
    expect(response.body).toMatchObject({
      selectedOrigin: {
        id: data.origin.id,
        name: 'Deploy Origin',
        coordinates: { galaxy: data.origin.galaxy, system: data.origin.system, slot: data.origin.slot },
        heliox: 777,
        ships: [{ key: 'scout', count: 8 }, { key: 'transporter', count: 3 }],
      },
      supportedSpeedOptions: [10, 25, 50, 75, 100],
      activeDeployment: null,
    });
    expect(response.body.eligibleDestinations).toEqual([{
      id: data.destination.id,
      name: data.destination.name,
      coordinates: { galaxy: data.destination.galaxy, system: data.destination.system, slot: data.destination.slot },
    }, {
      id: secondOwned.id,
      name: secondOwned.name,
      coordinates: { galaxy: secondOwned.galaxy, system: secondOwned.system, slot: secondOwned.slot },
    }]);
    expect(JSON.stringify(response.body)).not.toContain(foreignPlanet.id);
  });

  it('presents one active canonical deploy without legacy or scheduling internals', async () => {
    const data = await ownedFixture({ scouts: 5 });
    const accepted = await launchOwnedPlanetDeploy({
      accountId: data.user.id,
      originPlanetId: data.origin.id,
      destinationPlanetId: data.destination.id,
      speedPercent: 100,
      ships: { scout: 2 },
    });
    await prisma.fleetMission.update({
      where: { id: accepted.missionId },
      data: { jobId: 'legacy-job-id', ships: { scout: 999 }, cargo: { alloy: 999 } },
    });

    const response = await request(app).get(deploymentPath(data.origin.id)).set('Cookie', data.cookie).expect(200);
    expect(response.body.activeDeployment).toEqual({
      id: accepted.missionId,
      destination: {
        id: data.destination.id,
        name: data.destination.name,
        coordinates: { galaxy: data.destination.galaxy, system: data.destination.system, slot: data.destination.slot },
      },
      ships: { scout: 2 },
      fuelHeliox: accepted.fuelHeliox,
      durationSeconds: accepted.durationSeconds,
      departedAt: accepted.departedAt.toISOString(),
      arrivesAt: accepted.arrivesAt.toISOString(),
      status: 'OUTBOUND',
    });
    const serialized = JSON.stringify(response.body.activeDeployment);
    for (const internal of ['jobId', 'cargo', 'resultSummary', 'originId', 'deployOriginId', 'deployDestinationId', 'legacy-job-id']) {
      expect(serialized).not.toContain(internal);
    }
  });

  it('settles one due canonical deploy before reading the command summary', async () => {
    const data = await ownedFixture({ scouts: 4 });
    const accepted = await launchOwnedPlanetDeploy({
      accountId: data.user.id,
      originPlanetId: data.origin.id,
      destinationPlanetId: data.destination.id,
      speedPercent: 100,
      ships: { scout: 2 },
    });
    await prisma.fleetMission.update({ where: { id: accepted.missionId }, data: { arrivesAt: new Date(Date.now() - 1_000) } });

    const first = await request(app).get(deploymentPath(data.origin.id)).set('Cookie', data.cookie).expect(200);
    const second = await request(app).get(deploymentPath(data.origin.id)).set('Cookie', data.cookie).expect(200);
    expect(first.body.activeDeployment).toBeNull();
    expect(second.body.activeDeployment).toBeNull();
    expect(await prisma.fleetMission.findUniqueOrThrow({ where: { id: accepted.missionId } })).toMatchObject({ status: 'COMPLETE' });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.destination.id, key: 'scout' } } })).toMatchObject({ count: 2 });
    expect(await prisma.notification.count({ where: { userId: data.user.id, type: 'FLEET_DEPLOY_COMPLETE' } })).toBe(1);
  });

  it('launches through the authoritative service, returns a safe summary, and rejects conflicting or invalid requests without side effects', async () => {
    const data = await ownedFixture({ scouts: 5 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    const accepted = await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', data.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speed: 100, ships: { scout: 2 } })
      .expect(201);
    const deployment = accepted.body.activeDeployment;
    expect(deployment).toMatchObject({ destination: { id: data.destination.id }, ships: { scout: 2 }, status: 'OUTBOUND' });
    expect(JSON.stringify(deployment)).not.toMatch(/jobId|scheduling|cargo|deployOriginId|originId/);
    const mission = await prisma.fleetMission.findUniqueOrThrow({ where: { id: deployment.id } });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } })).toMatchObject({ count: 3 });
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({ heliox: before.heliox - mission.deployFuelHeliox! });

    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', data.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speed: 100, ships: { scout: 1 } })
      .expect(409);
    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', data.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speed: 100, ships: { forged: 1 } })
      .expect(400);
    expect(await prisma.fleetMission.count({ where: { originId: data.origin.id } })).toBe(1);

    const poor = await ownedFixture({ heliox: 0, scouts: 2 });
    const poorBefore = await prisma.planet.findUniqueOrThrow({ where: { id: poor.origin.id } });
    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', poor.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: poor.origin.id, destinationPlanetId: poor.destination.id, speed: 100, ships: { scout: 1 } })
      .expect(402);
    expect(await prisma.fleetMission.count({ where: { originId: poor.origin.id } })).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: poor.origin.id } })).toMatchObject({ heliox: poorBefore.heliox });
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: poor.origin.id, key: 'scout' } } })).toMatchObject({ count: 2 });

    const scarce = await ownedFixture({ scouts: 1 });
    await request(app)
      .post('/api/fleet/deployments')
      .set('Cookie', scarce.cookie)
      .set('X-Eonrover-Client', '1')
      .send({ originPlanetId: scarce.origin.id, destinationPlanetId: scarce.destination.id, speed: 100, ships: { scout: 2 } })
      .expect(409);
    expect(await prisma.fleetMission.count({ where: { originId: scarce.origin.id } })).toBe(0);
    expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: scarce.origin.id, key: 'scout' } } })).toMatchObject({ count: 1 });
  });

  it('returns the accepted deployment when post-commit Redis scheduling fails', async () => {
    const data = await ownedFixture({ scouts: 3 });
    const add = jest.spyOn(deployArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app)
        .post('/api/fleet/deployments')
        .set('Cookie', data.cookie)
        .set('X-Eonrover-Client', '1')
        .send({ originPlanetId: data.origin.id, destinationPlanetId: data.destination.id, speed: 100, ships: { scout: 2 } })
        .expect(201);
      expect(response.body.activeDeployment).toMatchObject({ destination: { id: data.destination.id }, ships: { scout: 2 }, status: 'OUTBOUND' });
      expect(JSON.stringify(response.body)).not.toMatch(/scheduling|jobId|Redis/);
      expect(await prisma.fleetMission.count({ where: { originId: data.origin.id, status: 'OUTBOUND' } })).toBe(1);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'scout' } } })).toMatchObject({ count: 1 });
    } finally {
      add.mockRestore();
    }
  });
});

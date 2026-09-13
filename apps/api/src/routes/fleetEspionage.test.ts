import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { espionageProbeArrivalQueue } from '../lib/redis';

const app = createApp();
let fixture = 0;
let coordinate = 1;

beforeEach(() => { fixture += 1; coordinate = 1; });

async function createPlayer(label: string, options: { protectedUntil?: Date | null; status?: 'ACTIVE' | 'SUSPENDED'; verified?: boolean } = {}) {
  const id = `${label}-${fixture}-${coordinate++}`;
  const user = await prisma.user.create({ data: {
    email: `${id}@example.invalid`, username: id, passwordHash: 'not-used',
    status: options.status ?? 'ACTIVE', emailVerifiedAt: options.verified === false ? null : new Date(),
    protectedUntil: options.protectedUntil,
  } });
  const token = `fleet-espionage-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createPlanet(ownerId: string, name: string, options: { galaxy?: number; system?: number; slot?: number; heliox?: number } = {}) {
  return prisma.planet.create({ data: {
    ownerId, name, galaxy: options.galaxy ?? 1, system: options.system ?? fixture * 10 + coordinate, slot: options.slot ?? 1,
    planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 2_000, heliox: options.heliox ?? 8_000, aether: 500, lastProductionAt: new Date(),
  } });
}

async function ownerFixture(options: { heliox?: number; probes?: number; technology?: number } = {}) {
  const owner = await createPlayer('probe-owner');
  const targetOwner = await createPlayer('probe-target');
  const system = 100 + fixture * 20 + coordinate;
  const origin = await createPlanet(owner.user.id, 'Probe Origin', { galaxy: 1, system, slot: 1, heliox: options.heliox });
  const target = await createPlanet(targetOwner.user.id, 'Probe Target', { galaxy: 1, system: system + 1, slot: 2 });
  await prisma.research.create({ data: { userId: owner.user.id, key: 'espionageTech', level: options.technology ?? 2 } });
  await prisma.ship.create({ data: { planetId: origin.id, key: 'probe', count: options.probes ?? 1 } });
  return { ...owner, targetOwner, origin, target };
}

function espionagePath(originPlanetId: string) {
  return `/api/fleet/espionage?originPlanetId=${originPlanetId}`;
}

function launchBody(data: Awaited<ReturnType<typeof ownerFixture>>) {
  return {
    originPlanetId: data.origin.id,
    target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot },
  };
}

async function removeWakeups(missionId: string) {
  for (const suffix of ['espionage-probe-arrival', 'espionage-probe-return']) {
    await (await espionageProbeArrivalQueue.getJob(`${suffix}-${missionId}`))?.remove();
  }
}

describe('player-safe Espionage Probe API', () => {
  it('requires authentication and CSRF, enforces owned origins, and preserves generic Fleet containment', async () => {
    const owner = await ownerFixture();
    const other = await ownerFixture();
    await request(app).get(espionagePath(owner.origin.id)).expect(401);
    await request(app).post('/api/fleet/espionage').set('Cookie', owner.cookie).send(launchBody(owner)).expect(403);
    await request(app).get(espionagePath(other.origin.id)).set('Cookie', owner.cookie).expect(404);
    await request(app).post('/api/fleet/espionage').set('Cookie', owner.cookie).set('X-Eonrover-Client', '1')
      .send({ ...launchBody(owner), originPlanetId: other.origin.id }).expect(404);
    await request(app).get('/api/fleet').set('Cookie', owner.cookie).expect(503, {
      error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE',
    });
    expect(await prisma.fleetMission.count()).toBe(0);
  });

  it('returns an authoritative, strictly allowlisted origin summary without target or mission identities', async () => {
    const data = await ownerFixture({ heliox: 777, probes: 3, technology: 4 });
    const response = await request(app).get(espionagePath(data.origin.id)).set('Cookie', data.cookie).expect(200);
    expect(response.body).toEqual({
      selectedOrigin: {
        coordinates: { galaxy: data.origin.galaxy, system: data.origin.system, slot: data.origin.slot },
        heliox: 777, availableProbes: 3, espionageTechnologyLevel: 4,
      },
      activeEspionage: null,
    });
    const serialized = JSON.stringify(response.body);
    for (const sensitive of [data.origin.id, data.target.id, data.user.id, data.targetOwner.user.id, 'missionId', 'jobId', 'fuelHeliox', 'durationSeconds', 'disclosureSnapshot', 'scheduling']) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('accepts only a coordinate-only launch, reserves authoritative state, and returns the safe active projection', async () => {
    const data = await ownerFixture();
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    const response = await request(app).post('/api/fleet/espionage').set('Cookie', data.cookie).set('X-Eonrover-Client', '1')
      .send(launchBody(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { espionageOriginPlanetId: data.origin.id } });
    try {
      expect(response.body.activeEspionage).toEqual({
        phase: 'OUTBOUND',
        target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot } },
        departedAt: mission.departedAt.toISOString(), arrivesAt: mission.arrivesAt.toISOString(), returnsAt: mission.returnsAt!.toISOString(),
        intelligenceReportReady: false,
      });
      expect(Object.keys(response.body.activeEspionage).sort()).toEqual(['arrivesAt', 'departedAt', 'intelligenceReportReady', 'phase', 'returnsAt', 'target']);
      expect(JSON.stringify(response.body)).not.toMatch(/missionId|targetId|jobId|fuelHeliox|durationSeconds|snapshot|disclosure/i);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 0 });
      expect(await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).toMatchObject({
        heliox: before.heliox - mission.espionageOutboundFuelHeliox! - mission.espionageReturnFuelHeliox!,
      });
    } finally {
      await removeWakeups(mission.id);
    }
  });

  it('rejects spoofed, protected, unavailable, invalid, and duplicate requests with no side effects', async () => {
    const invalid = await ownerFixture();
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: invalid.origin.id } });
    await request(app).post('/api/fleet/espionage').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1').send({
      ...launchBody(invalid), targetPlanetId: invalid.target.id, ships: { probe: 99 }, cargo: { heliox: 0 }, speed: 1,
    }).expect(400);
    await request(app).post('/api/fleet/espionage').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1').send({
      originPlanetId: invalid.origin.id, target: { galaxy: 1, system: 1, slot: 1.5 },
    }).expect(400);
    expect(await prisma.fleetMission.count({ where: { espionageOriginPlanetId: invalid.origin.id } })).toBe(0);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: invalid.origin.id } })).toMatchObject({ heliox: before.heliox });

    const protectedOwner = await createPlayer('protected-target', { protectedUntil: new Date(Date.now() + 60_000) });
    const protectedTarget = await createPlanet(protectedOwner.user.id, 'Protected', { galaxy: 1, system: invalid.target.system + 20, slot: 3 });
    await request(app).post('/api/fleet/espionage').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: invalid.origin.id, target: { galaxy: protectedTarget.galaxy, system: protectedTarget.system, slot: protectedTarget.slot } }).expect(409);
    await request(app).post('/api/fleet/espionage').set('Cookie', invalid.cookie).set('X-Eonrover-Client', '1')
      .send({ originPlanetId: invalid.origin.id, target: { galaxy: 1, system: 399, slot: 12 } }).expect(404);
    expect(await prisma.fleetMission.count({ where: { espionageOriginPlanetId: invalid.origin.id } })).toBe(0);

    const active = await ownerFixture();
    const first = await request(app).post('/api/fleet/espionage').set('Cookie', active.cookie).set('X-Eonrover-Client', '1').send(launchBody(active)).expect(201);
    try {
      await request(app).post('/api/fleet/espionage').set('Cookie', active.cookie).set('X-Eonrover-Client', '1').send(launchBody(active)).expect(409);
      expect(await prisma.fleetMission.count({ where: { espionageOriginPlanetId: active.origin.id } })).toBe(1);
    } finally {
      const mission = await prisma.fleetMission.findFirstOrThrow({ where: { espionageOriginPlanetId: active.origin.id } });
      await removeWakeups(mission.id);
      expect(first.body.activeEspionage.phase).toBe('OUTBOUND');
    }
  });

  it('settles a due mission once before GET and exposes only return state plus report readiness', async () => {
    const data = await ownerFixture();
    const accepted = await request(app).post('/api/fleet/espionage').set('Cookie', data.cookie).set('X-Eonrover-Client', '1').send(launchBody(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { espionageOriginPlanetId: data.origin.id } });
    try {
      const arrivesAt = new Date(Date.now() - 2_000);
      await prisma.fleetMission.update({ where: { id: mission.id }, data: {
        departedAt: new Date(arrivesAt.getTime() - mission.espionageOutboundDurationSeconds! * 1_000),
        arrivesAt,
        returnsAt: new Date(arrivesAt.getTime() + mission.espionageReturnDurationSeconds! * 1_000),
      } });
      const first = await request(app).get(espionagePath(data.origin.id)).set('Cookie', data.cookie).expect(200);
      const second = await request(app).get(espionagePath(data.origin.id)).set('Cookie', data.cookie).expect(200);
      expect(first.body.activeEspionage).toMatchObject({ phase: 'RETURNING', intelligenceReportReady: true });
      expect(second.body.activeEspionage).toMatchObject({ phase: 'RETURNING', intelligenceReportReady: true });
      expect(await prisma.espionageProbeReport.count({ where: { missionId: mission.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: { in: [data.user.id, data.targetOwner.user.id] } } })).toBe(2);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 0 });
      expect(accepted.body.activeEspionage.intelligenceReportReady).toBe(false);
    } finally {
      await removeWakeups(mission.id);
    }
  });

  it('returns an accepted launch when post-commit Redis scheduling fails without disclosing scheduling state', async () => {
    const data = await ownerFixture();
    const add = jest.spyOn(espionageProbeArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app).post('/api/fleet/espionage').set('Cookie', data.cookie).set('X-Eonrover-Client', '1').send(launchBody(data)).expect(201);
      expect(response.body.activeEspionage).toMatchObject({ phase: 'OUTBOUND', intelligenceReportReady: false });
      expect(JSON.stringify(response.body)).not.toMatch(/scheduling|jobId|Redis/i);
      expect(await prisma.fleetMission.count({ where: { espionageOriginPlanetId: data.origin.id, espionageProbePhase: 'OUTBOUND' } })).toBe(1);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'probe' } } })).toMatchObject({ count: 0 });
    } finally {
      add.mockRestore();
    }
  });
});

import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { frigateStrikeArrivalQueue } from '../lib/redis';

const app = createApp();
let fixture = 0;
const jobs = new Set<string>();

async function player(label: string, options: { protected?: boolean; verified?: boolean; active?: boolean } = {}) {
  const user = await prisma.user.create({ data: {
    email: `${label}-${fixture}@example.invalid`, username: `${label}-${fixture}`, passwordHash: 'not-used',
    status: options.active === false ? 'SUSPENDED' : 'ACTIVE',
    emailVerifiedAt: options.verified === false ? null : new Date(),
    protectedUntil: options.protected ? new Date(Date.now() + 60_000) : null,
  } });
  const token = `frigate-command-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function planet(ownerId: string, name: string, system: number, slot: number, heliox = 9_000, galaxy = 1) {
  return prisma.planet.create({ data: {
    ownerId, name, galaxy, system, slot, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox, aether: 1_000, lastProductionAt: new Date(),
  } });
}

async function strikeFixture(options: { frigates?: number; heliox?: number; protected?: boolean; verified?: boolean; targetGalaxy?: number } = {}) {
  fixture += 1;
  const attacker = await player('frigate-attacker');
  const defender = await player('frigate-defender', { protected: options.protected, verified: options.verified });
  const origin = await planet(attacker.user.id, 'Frigate Origin', 100 + fixture * 10, 1, options.heliox);
  const target = await planet(defender.user.id, 'Frigate Target', 101 + fixture * 10, 2, 9_000, options.targetGalaxy ?? 1);
  await prisma.ship.create({ data: { planetId: origin.id, key: 'frigate', count: options.frigates ?? 3 } });
  return { attacker, defender, origin, target };
}

function activePath(originId: string) { return `/api/fleet/frigate-strikes?originPlanetId=${originId}`; }
function commandPath(data: Awaited<ReturnType<typeof strikeFixture>>, quantity = 2) {
  return `/api/fleet/frigate-strikes/command?originPlanetId=${data.origin.id}&galaxy=${data.target.galaxy}&system=${data.target.system}&position=${data.target.slot}&quantity=${quantity}`;
}
function body(data: Awaited<ReturnType<typeof strikeFixture>>, quantity = 2) {
  return { originPlanetId: data.origin.id, target: { galaxy: data.target.galaxy, system: data.target.system, position: data.target.slot }, quantity };
}
async function removeJobs(missionId: string) {
  for (const prefix of ['frigate-strike-arrival', 'frigate-strike-return']) {
    const id = `${prefix}-${missionId}`;
    jobs.delete(id);
    await (await frigateStrikeArrivalQueue.getJob(id))?.remove();
  }
}

afterEach(async () => {
  for (const id of jobs) await (await frigateStrikeArrivalQueue.getJob(id))?.remove();
  jobs.clear();
  jest.restoreAllMocks();
});

describe('player-safe Frigate strike command API', () => {
  it('requires authentication, CSRF, active ownership, and preserves Fleet and Corvette containment', async () => {
    const data = await strikeFixture();
    const other = await strikeFixture();
    await request(app).get(activePath(data.origin.id)).expect(401);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).send(body(data)).expect(403);
    await request(app).get(activePath(other.origin.id)).set('Cookie', data.attacker.cookie).expect(404);
    await prisma.user.update({ where: { id: data.attacker.user.id }, data: { status: 'SUSPENDED' } });
    await request(app).get(activePath(data.origin.id)).set('Cookie', data.attacker.cookie).expect(403);
    await request(app).get('/api/fleet').set('Cookie', other.attacker.cookie).expect(503, {
      error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE',
    });
    await request(app).get(`/api/fleet/strikes?originPlanetId=${other.origin.id}`).set('Cookie', other.attacker.cookie).expect(200);
    await request(app).get(`/api/fleet/espionage?originPlanetId=${other.origin.id}`).set('Cookie', other.attacker.cookie).expect(200);
  });

  it('projects only safe active state and a server-derived command estimate', async () => {
    const data = await strikeFixture({ frigates: 4, heliox: 9_000 });
    const active = await request(app).get(activePath(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200);
    expect(active.body).toEqual({
      selectedOrigin: {
        coordinates: { galaxy: data.origin.galaxy, system: data.origin.system, slot: data.origin.slot },
        heliox: 9_000, availableFrigates: 4, maximumQuantity: 4,
      },
      activeFrigateStrike: null,
    });
    const command = await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200);
    expect(command.body).toMatchObject({
      target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot } },
      quantity: 2,
      eligibility: { eligible: true, code: 'ELIGIBLE' },
      selectedOrigin: { availableFrigates: 4, maximumQuantity: 4 },
      estimate: { durationSeconds: expect.any(Number), fuelHeliox: expect.any(Number) },
      affordability: { requiredHeliox: expect.any(Number), affordable: true },
    });
    const serialized = JSON.stringify(command.body);
    for (const hidden of [data.target.id, data.defender.user.id, data.attacker.user.id, 'seed', 'resolverVersion', 'jobId', 'queue']) expect(serialized).not.toContain(hidden);
  });

  it('strictly validates coordinate-only launch input and preserves state on rejected commands', async () => {
    const data = await strikeFixture();
    const before = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } }),
      prisma.fleetMission.count(),
      prisma.corvetteStrikeReport.count(),
    ]);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send({
      ...body(data), targetPlanetId: data.target.id, ships: { frigate: 99 }, speed: 1, fuel: 1, seed: 'forged',
    }).expect(400);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send({ ...body(data), quantity: 1.5 }).expect(400);
    await request(app).get(`/api/fleet/frigate-strikes/command?originPlanetId=${data.origin.id}&galaxy=1x&system=2&position=3&quantity=1`).set('Cookie', data.attacker.cookie).expect(400);
    const after = await Promise.all([
      prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } }),
      prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } }),
      prisma.fleetMission.count(),
      prisma.corvetteStrikeReport.count(),
    ]);
    expect(after).toEqual(before);
  });

  it('uses only authoritative launch facts and returns an allowlisted accepted projection', async () => {
    const data = await strikeFixture({ frigates: 4 });
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    const response = await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { frigateStrikeOriginPlanetId: data.origin.id } });
    jobs.add(`frigate-strike-arrival-${mission.id}`);
    try {
      expect(response.body).toEqual({
        activeFrigateStrike: {
          phase: 'OUTBOUND', target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot } },
          departedAt: mission.departedAt.toISOString(), arrivesAt: mission.arrivesAt.toISOString(), returnsAt: mission.returnsAt!.toISOString(),
        },
      });
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } })).toMatchObject({ count: 2 });
      expect((await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox).toBe(before.heliox - mission.frigateStrikeOutboundFuelHeliox! - mission.frigateStrikeReturnFuelHeliox!);
      expect(await prisma.fleetMission.count({ where: { corvetteStrikeOriginPlanetId: { not: null } } })).toBe(0);
      expect(JSON.stringify(response.body)).not.toMatch(/missionId|fuel|duration|seed|resolver|job|queue/i);
    } finally { await removeJobs(mission.id); }
  });

  it('contains unavailable, protected, same-galaxy, resource, and active-origin failures without side effects', async () => {
    const data = await strikeFixture();
    const protectedData = await strikeFixture({ protected: true });
    const unavailableData = await strikeFixture({ verified: false });
    const crossGalaxy = await strikeFixture({ targetGalaxy: 2 });
    const noShips = await strikeFixture({ frigates: 1 });
    const noFuel = await strikeFixture({ heliox: 0 });
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', protectedData.attacker.cookie).set('X-Eonrover-Client', '1').send(body(protectedData)).expect(409);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', unavailableData.attacker.cookie).set('X-Eonrover-Client', '1').send(body(unavailableData)).expect(404);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', crossGalaxy.attacker.cookie).set('X-Eonrover-Client', '1').send(body(crossGalaxy)).expect(400);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', noShips.attacker.cookie).set('X-Eonrover-Client', '1').send(body(noShips)).expect(409);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', noFuel.attacker.cookie).set('X-Eonrover-Client', '1').send(body(noFuel)).expect(402);
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { frigateStrikeOriginPlanetId: data.origin.id } });
    jobs.add(`frigate-strike-arrival-${mission.id}`);
    try {
      await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(409);
      expect((await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200)).body.eligibility).toEqual({ eligible: false, code: 'STRIKE_IN_PROGRESS' });
    } finally { await removeJobs(mission.id); }
  });

  it('rechecks the same safe eligibility policy inside launch after command state changes', async () => {
    const data = await strikeFixture();
    const before = {
      heliox: (await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox,
      frigates: (await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } })).count,
      missions: await prisma.fleetMission.count(), notifications: await prisma.notification.count(),
    };
    expect((await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200)).body.eligibility)
      .toEqual({ eligible: true, code: 'ELIGIBLE' });
    await prisma.user.update({ where: { id: data.defender.user.id }, data: { protectedUntil: new Date(Date.now() + 60_000) } });
    expect((await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200)).body.eligibility)
      .toEqual({ eligible: false, code: 'TARGET_PROTECTED' });
    await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(409);
    const after = {
      heliox: (await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox,
      frigates: (await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'frigate' } } })).count,
      missions: await prisma.fleetMission.count(), notifications: await prisma.notification.count(),
    };
    expect(after).toEqual(before);
  });

  it('has one concurrent launch winner and settles a due active state exactly once', async () => {
    const data = await strikeFixture({ frigates: 4 });
    const responses = await Promise.all([
      request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)),
      request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { frigateStrikeOriginPlanetId: data.origin.id } });
    jobs.add(`frigate-strike-arrival-${mission.id}`);
    try {
      expect(await prisma.fleetMission.count({ where: { frigateStrikeOriginPlanetId: data.origin.id } })).toBe(1);
      await prisma.fleetMission.update({ where: { id: mission.id }, data: {
        departedAt: new Date(Date.now() - mission.frigateStrikeOutboundDurationSeconds! * 1_000 - 1_000),
        arrivesAt: new Date(Date.now() - 1_000),
      } });
      await request(app).get(activePath(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200);
      await request(app).get(activePath(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200);
      expect(await prisma.frigateStrikeReport.count({ where: { missionId: mission.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: { in: [data.attacker.user.id, data.defender.user.id] } } })).toBe(2);
    } finally { await removeJobs(mission.id); }
  });

  it('keeps an accepted reservation when post-commit Redis dispatch fails without exposing scheduling internals', async () => {
    const data = await strikeFixture();
    const add = jest.spyOn(frigateStrikeArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app).post('/api/fleet/frigate-strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
      expect(response.body.activeFrigateStrike.phase).toBe('OUTBOUND');
      expect(JSON.stringify(response.body)).not.toMatch(/redis|scheduling|jobId/i);
      expect(await prisma.fleetMission.count({ where: { frigateStrikeOriginPlanetId: data.origin.id } })).toBe(1);
    } finally { add.mockRestore(); }
  });
});

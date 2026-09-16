import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { corvetteStrikeArrivalQueue } from '../lib/redis';

const app = createApp();
let fixture = 0;

async function player(label: string, protectedUntil: Date | null = null) {
  const user = await prisma.user.create({ data: {
    email: `${label}-${fixture}@example.invalid`, username: `${label}-${fixture}`, passwordHash: 'not-used',
    status: 'ACTIVE', emailVerifiedAt: new Date(), protectedUntil,
  } });
  const token = `fleet-strike-${user.id}`;
  await prisma.session.create({ data: { id: sessionTokenDigest(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

async function planet(ownerId: string, name: string, system: number, slot: number, heliox = 9_000) {
  return prisma.planet.create({ data: {
    ownerId, name, galaxy: 1, system, slot, planetType: 'TEMPERATE', temperature: 10, solarIndex: 0.7,
    alloy: 1_000, heliox, aether: 1_000, lastProductionAt: new Date(),
  } });
}

async function strikeFixture(options: { corvettes?: number; heliox?: number; protected?: boolean } = {}) {
  fixture += 1;
  const attacker = await player('strike-attacker');
  const defender = await player('strike-defender', options.protected ? new Date(Date.now() + 60_000) : null);
  const origin = await planet(attacker.user.id, 'Strike Origin', 100 + fixture * 10, 1, options.heliox);
  const target = await planet(defender.user.id, 'Strike Target', 101 + fixture * 10, 2);
  await prisma.ship.create({ data: { planetId: origin.id, key: 'corvette', count: options.corvettes ?? 3 } });
  return { attacker, defender, origin, target };
}

function path(originId: string) { return `/api/fleet/strikes?originPlanetId=${originId}`; }
function commandPath(data: Awaited<ReturnType<typeof strikeFixture>>, corvettes = 2) {
  return `/api/fleet/strikes/command?originPlanetId=${data.origin.id}&galaxy=${data.target.galaxy}&system=${data.target.system}&slot=${data.target.slot}&corvettes=${corvettes}`;
}
function body(data: Awaited<ReturnType<typeof strikeFixture>>) {
  return { originPlanetId: data.origin.id, target: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot }, corvettes: 2 };
}
async function removeJobs(missionId: string) {
  for (const prefix of ['corvette-strike-arrival', 'corvette-strike-return']) await (await corvetteStrikeArrivalQueue.getJob(`${prefix}-${missionId}`))?.remove();
}

describe('player-safe Corvette strike command API', () => {
  it('requires authentication and CSRF, enforces origin ownership, and preserves generic Fleet containment', async () => {
    const data = await strikeFixture();
    const other = await strikeFixture();
    await request(app).get(path(data.origin.id)).expect(401);
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).send(body(data)).expect(403);
    await request(app).get(path(other.origin.id)).set('Cookie', data.attacker.cookie).expect(404);
    await request(app).get('/api/fleet').set('Cookie', data.attacker.cookie).expect(503, {
      error: 'Fleet missions are temporarily unavailable.', code: 'FLEET_MISSIONS_UNAVAILABLE',
    });
  });

  it('returns an authoritative allowlisted origin summary and launches with coordinate-only authority', async () => {
    const data = await strikeFixture({ corvettes: 4, heliox: 9_000 });
    expect((await request(app).get(path(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200)).body).toEqual({
      selectedOrigin: { coordinates: { galaxy: data.origin.galaxy, system: data.origin.system, slot: data.origin.slot }, heliox: 9_000, availableCorvettes: 4 },
      activeStrike: null,
    });
    const command = await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200);
    expect(command.body).toMatchObject({
      selectedOrigin: { availableCorvettes: 4, maximumQuantity: 4 },
      target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot } },
      quantity: 2,
      eligibility: { eligible: true, code: 'ELIGIBLE' },
      estimate: { durationSeconds: expect.any(Number), fuelHeliox: expect.any(Number) },
      affordability: { requiredHeliox: expect.any(Number), affordable: true },
      activeStrike: null,
    });
    for (const hidden of [data.target.id, data.attacker.user.id, data.defender.user.id, 'seed', 'resolverVersion', 'jobId', 'queue', 'protectedUntil']) {
      expect(JSON.stringify(command.body)).not.toContain(hidden);
    }
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    const response = await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { corvetteStrikeOriginPlanetId: data.origin.id } });
    try {
      expect(response.body.activeStrike).toEqual({
        phase: 'OUTBOUND', target: { coordinates: { galaxy: data.target.galaxy, system: data.target.system, slot: data.target.slot } },
        departedAt: mission.departedAt.toISOString(), arrivesAt: mission.arrivesAt.toISOString(), returnsAt: mission.returnsAt!.toISOString(),
      });
      const serialized = JSON.stringify(response.body);
      for (const secret of [mission.id, data.target.id, data.attacker.user.id, data.defender.user.id, 'jobId', 'fuelHeliox', 'durationSeconds', 'seed', 'snapshot']) expect(serialized).not.toContain(secret);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).toMatchObject({ count: 2 });
      expect((await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox).toBe(before.heliox - mission.corvetteStrikeOutboundFuelHeliox! - mission.corvetteStrikeReturnFuelHeliox!);
    } finally { await removeJobs(mission.id); }
  });

  it('rejects spoofed, protected, unavailable, insufficient, and active commands without side effects', async () => {
    const data = await strikeFixture();
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } });
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send({ ...body(data), targetPlanetId: data.target.id, ships: { corvette: 99 }, speed: 1, fuel: 1 }).expect(400);
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send({ ...body(data), corvettes: 1.5 }).expect(400);
    expect((await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox).toBe(before.heliox);
    const protectedData = await strikeFixture({ protected: true });
    await request(app).post('/api/fleet/strikes').set('Cookie', protectedData.attacker.cookie).set('X-Eonrover-Client', '1').send(body(protectedData)).expect(409);
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send({ ...body(data), target: { galaxy: 1, system: 399, slot: 12 } }).expect(404);
    const noShips = await strikeFixture({ corvettes: 1 });
    await request(app).post('/api/fleet/strikes').set('Cookie', noShips.attacker.cookie).set('X-Eonrover-Client', '1').send(body(noShips)).expect(409);
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { corvetteStrikeOriginPlanetId: data.origin.id } });
    try { await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(409); } finally { await removeJobs(mission.id); }
  });

  it('uses the same eligibility result for command estimation and the locked launch recheck', async () => {
    const data = await strikeFixture();
    const before = {
      heliox: (await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox,
      corvettes: (await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).count,
      missions: await prisma.fleetMission.count(), notifications: await prisma.notification.count(),
    };
    expect((await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200)).body.eligibility)
      .toEqual({ eligible: true, code: 'ELIGIBLE' });
    await prisma.user.update({ where: { id: data.defender.user.id }, data: { protectedUntil: new Date(Date.now() + 60_000) } });
    expect((await request(app).get(commandPath(data)).set('Cookie', data.attacker.cookie).expect(200)).body.eligibility)
      .toEqual({ eligible: false, code: 'TARGET_PROTECTED' });
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(409);
    const after = {
      heliox: (await prisma.planet.findUniqueOrThrow({ where: { id: data.origin.id } })).heliox,
      corvettes: (await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).count,
      missions: await prisma.fleetMission.count(), notifications: await prisma.notification.count(),
    };
    expect(after).toEqual(before);
  });

  it('returns only safe eligibility codes for malformed, unavailable, self-owned, and cross-galaxy command targets', async () => {
    const data = await strikeFixture();
    await request(app).get(`/api/fleet/strikes/command?originPlanetId=${data.origin.id}&galaxy=1x&system=1&slot=1&corvettes=1`).set('Cookie', data.attacker.cookie).expect(400);
    const unavailable = await request(app).get(`/api/fleet/strikes/command?originPlanetId=${data.origin.id}&galaxy=1&system=399&slot=12&corvettes=1`).set('Cookie', data.attacker.cookie).expect(200);
    expect(unavailable.body.eligibility).toEqual({ eligible: false, code: 'TARGET_UNAVAILABLE' });
    const self = await request(app).get(`/api/fleet/strikes/command?originPlanetId=${data.origin.id}&galaxy=1&system=${data.origin.system}&slot=${data.origin.slot}&corvettes=1`).set('Cookie', data.attacker.cookie).expect(200);
    expect(self.body.eligibility).toEqual({ eligible: false, code: 'INVALID_TARGET' });
    const cross = await request(app).get(`/api/fleet/strikes/command?originPlanetId=${data.origin.id}&galaxy=2&system=${data.target.system}&slot=${data.target.slot}&corvettes=1`).set('Cookie', data.attacker.cookie).expect(200);
    expect(cross.body.eligibility).toEqual({ eligible: false, code: 'INVALID_TARGET' });
  });

  it('settles a due strike once before GET without duplicate report, notifications, or survivor restoration', async () => {
    const data = await strikeFixture();
    await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
    const mission = await prisma.fleetMission.findFirstOrThrow({ where: { corvetteStrikeOriginPlanetId: data.origin.id } });
    try {
      const due = new Date(Date.now() - 2_000);
      await prisma.user.update({ where: { id: data.defender.user.id }, data: { protectedUntil: new Date(Date.now() + 60_000) } });
      await prisma.fleetMission.update({ where: { id: mission.id }, data: { departedAt: new Date(due.getTime() - mission.corvetteStrikeOutboundDurationSeconds! * 1_000), arrivesAt: due } });
      const first = await request(app).get(path(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200);
      const second = await request(app).get(path(data.origin.id)).set('Cookie', data.attacker.cookie).expect(200);
      expect(first.body.activeStrike?.phase).toBe(second.body.activeStrike?.phase);
      expect(await prisma.corvetteStrikeReport.count({ where: { missionId: mission.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: { in: [data.attacker.user.id, data.defender.user.id] } } })).toBe(2);
      expect(await prisma.ship.findUniqueOrThrow({ where: { planetId_key: { planetId: data.origin.id, key: 'corvette' } } })).toMatchObject({ count: 1 });
    } finally { await removeJobs(mission.id); }
  });

  it('keeps an accepted reservation when post-commit Redis dispatch fails without exposing scheduling details', async () => {
    const data = await strikeFixture();
    const add = jest.spyOn(corvetteStrikeArrivalQueue, 'add').mockRejectedValueOnce(new Error('disposable Redis failure'));
    try {
      const response = await request(app).post('/api/fleet/strikes').set('Cookie', data.attacker.cookie).set('X-Eonrover-Client', '1').send(body(data)).expect(201);
      expect(response.body.activeStrike.phase).toBe('OUTBOUND');
      expect(JSON.stringify(response.body)).not.toMatch(/redis|scheduling|jobId/i);
      expect(await prisma.fleetMission.count({ where: { corvetteStrikeOriginPlanetId: data.origin.id } })).toBe(1);
    } finally { add.mockRestore(); }
  });
});

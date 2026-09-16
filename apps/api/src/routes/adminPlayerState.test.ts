import { MissionStatus, MissionType, TransportMissionPhase } from '@prisma/client';
import request from 'supertest';
import * as config from '../config';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();
const NOW = new Date('2030-01-01T00:00:00.000Z');
let sequence = 1;

async function createAccount(options: {
  role?: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  verified?: boolean;
  username?: string;
  email?: string;
  withSession?: boolean;
} = {}) {
  const current = sequence++;
  const user = await prisma.user.create({
    data: {
      email: options.email ?? `admin-boundary-${current}@example.com`,
      username: options.username ?? `admin-boundary-${current}`,
      passwordHash: `private-hash-${current}`,
      role: options.role ?? 'PLAYER',
      status: options.status ?? 'ACTIVE',
      emailVerifiedAt: options.verified === false ? null : NOW,
    },
  });
  if (!options.withSession) return { user, cookie: null };

  const rawToken = `private-session-${current}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${rawToken}` };
}

async function createPlanet(ownerId: string) {
  const coordinate = sequence++;
  return prisma.planet.create({
    data: {
      ownerId,
      name: `Read-only ${coordinate}`,
      galaxy: 1,
      system: 1 + Math.floor(coordinate / 12),
      slot: (coordinate % 12) + 1,
      planetType: 'TEMPERATE',
      temperature: 15,
      solarIndex: 1,
      alloy: 100,
      heliox: 100,
      aether: 100,
      lastProductionAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    },
  });
}

async function createCanonicalOperation(options: {
  originId: string;
  targetId: string;
  target: { galaxy: number; system: number; slot: number };
  kind: 'deployOutbound' | 'transportReturning' | 'transportWaiting';
}) {
  const departedAt = NOW;
  const arrivesAt = new Date(NOW.getTime() + 60_000);
  const base = {
    originId: options.originId,
    targetId: options.targetId,
    targetGalaxy: options.target.galaxy,
    targetSystem: options.target.system,
    targetSlot: options.target.slot,
    ships: {},
    cargo: {},
    speedPercent: 100,
    departedAt,
    arrivesAt,
  };
  if (options.kind === 'deployOutbound') {
    return prisma.fleetMission.create({
      data: {
        ...base,
        missionType: MissionType.DEPLOY,
        status: MissionStatus.OUTBOUND,
        deployOriginId: options.originId,
        deployDestinationId: options.targetId,
      },
    });
  }
  return prisma.fleetMission.create({
    data: {
      ...base,
      missionType: MissionType.TRANSPORT,
      status: options.kind === 'transportReturning' ? MissionStatus.RETURNING : MissionStatus.OUTBOUND,
      returnsAt: options.kind === 'transportReturning' ? new Date(NOW.getTime() + 120_000) : null,
      transportOriginId: options.originId,
      transportDestinationId: options.targetId,
      transportPhase: options.kind === 'transportReturning'
        ? TransportMissionPhase.RETURNING
        : TransportMissionPhase.AWAITING_DESTINATION_CAPACITY,
    },
  });
}

function privateValues(account: { id: string; passwordHash: string }, planet: { id: string }) {
  return [account.id, account.passwordHash, planet.id, 'private-session'];
}

describe('administrator read-only API contract', () => {
  it('retains the exact status response and reserves every endpoint for current ADMIN accounts', async () => {
    const player = await createAccount({ withSession: true });
    const moderator = await createAccount({ role: 'MODERATOR', withSession: true });
    const admin = await createAccount({ role: 'ADMIN', withSession: true });

    for (const path of ['/api/admin/status', '/api/admin/overview', '/api/admin/players?query=ad']) {
      await request(app).get(path).expect(401);
      for (const actor of [player, moderator]) {
        await request(app).get(path).set('Cookie', actor.cookie!).expect(403, {
          error: 'Insufficient permissions', code: 'FORBIDDEN',
        });
      }
    }
    await request(app).get('/api/admin/status').set('Cookie', admin.cookie!).expect(200, { status: 'read-only' });
  });

  it('projects only aggregate canonical overview counts and excludes legacy missions', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const pending = await createAccount({ status: 'PENDING_VERIFICATION', verified: false });
    await createAccount({ status: 'SUSPENDED' });
    await createAccount({ status: 'BANNED' });
    const originA = await createPlanet(pending.user.id);
    const targetA = await createPlanet(pending.user.id);
    const originB = await createPlanet(pending.user.id);
    const targetB = await createPlanet(pending.user.id);
    const originC = await createPlanet(pending.user.id);
    const targetC = await createPlanet(pending.user.id);
    await createCanonicalOperation({ originId: originA.id, targetId: targetA.id, target: targetA, kind: 'deployOutbound' });
    await createCanonicalOperation({ originId: originB.id, targetId: targetB.id, target: targetB, kind: 'transportReturning' });
    await createCanonicalOperation({ originId: originC.id, targetId: targetC.id, target: targetC, kind: 'transportWaiting' });
    await prisma.fleetMission.create({
      data: {
        originId: originA.id,
        targetId: targetA.id,
        targetGalaxy: targetA.galaxy,
        targetSystem: targetA.system,
        targetSlot: targetA.slot,
        missionType: MissionType.ATTACK,
        ships: { corvette: 99 },
        cargo: { alloy: 999 },
        speedPercent: 100,
        departedAt: NOW,
        arrivesAt: new Date(NOW.getTime() + 60_000),
        status: MissionStatus.OUTBOUND,
      },
    });

    const response = await request(app).get('/api/admin/overview').set('Cookie', admin.cookie!).expect(200);
    expect(response.body).toEqual({
      accounts: { pendingVerification: 1, active: 1, suspended: 1, banned: 1, verified: 3 },
      planets: { owned: 6 },
      operations: { outbound: 1, returning: 1, awaitingDestinationCapacity: 1 },
    });
    const serialized = JSON.stringify(response.body);
    for (const value of [originA.id, targetA.id, 'corvette', '999']) expect(serialized).not.toContain(value);
  });

  it('returns at most 25 stable safe player summaries for a validated identifier lookup', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const created = [];
    for (let index = 29; index >= 0; index -= 1) {
      created.push(await createAccount({
        username: `lookup-${String(index).padStart(2, '0')}`,
        email: `lookup-${String(index).padStart(2, '0')}@example.com`,
        status: index === 0 ? 'SUSPENDED' : 'ACTIVE',
        verified: index !== 1,
      }));
    }

    const response = await request(app).get('/api/admin/players?query=lookup').set('Cookie', admin.cookie!).expect(200);
    expect(response.body.players).toHaveLength(25);
    expect(response.body.players.map((player: { username: string }) => player.username)).toEqual(
      Array.from({ length: 25 }, (_, index) => `lookup-${String(index).padStart(2, '0')}`),
    );
    expect(response.body.players[0]).toEqual({
      username: 'lookup-00', email: 'lookup-00@example.com', status: 'SUSPENDED', verified: true,
    });
    const serialized = JSON.stringify(response.body);
    for (const player of created) {
      expect(serialized).not.toContain(player.user.id);
      expect(serialized).not.toContain(player.user.passwordHash);
    }
    for (const key of ['id', 'role', 'planets', 'missions', 'sessions', 'passwordHash', 'notifications']) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it('rejects missing, malformed, unknown, and overlong player lookup values without writes', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const player = await createAccount({ username: 'lookup-safe' });
    const planet = await createPlanet(player.user.id);
    const before = {
      admin: await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } }),
      player: await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } }),
      planet: await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }),
      audit: await prisma.auditLog.count(),
    };

    for (const path of [
      '/api/admin/players',
      '/api/admin/players?query=a',
      `/api/admin/players?query=${'x'.repeat(101)}`,
      '/api/admin/players?query=lookup&extra=unexpected',
      '/api/admin/players?query[]=lookup',
    ]) {
      await request(app).get(path).set('Cookie', admin.cookie!).expect(400);
    }
    await request(app).get('/api/admin/overview').set('Cookie', admin.cookie!).expect(200);
    await request(app).get('/api/admin/players?query=lookup-safe').set('Cookie', admin.cookie!).expect(200);

    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).toEqual(before.admin);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } })).toEqual(before.player);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } })).toEqual(before.planet);
    expect(await prisma.auditLog.count()).toBe(before.audit);
  });

  it('returns disabled-portal failures before session or application queries', async () => {
    const original = config.getApiConfig();
    const configSpy = jest.spyOn(config, 'getApiConfig').mockReturnValue({ ...original, adminPortalEnabled: false });
    const userCount = jest.spyOn(prisma.user, 'count');
    const planetCount = jest.spyOn(prisma.planet, 'count');
    const missionCount = jest.spyOn(prisma.fleetMission, 'count');
    try {
      for (const path of ['/api/admin/status', '/api/admin/overview', '/api/admin/players?query=ad']) {
        await request(app).get(path).expect(503, {
          error: 'Administrator portal is unavailable.', code: 'ADMIN_PORTAL_UNAVAILABLE',
        });
      }
      expect(userCount).not.toHaveBeenCalled();
      expect(planetCount).not.toHaveBeenCalled();
      expect(missionCount).not.toHaveBeenCalled();
    } finally {
      userCount.mockRestore();
      planetCount.mockRestore();
      missionCount.mockRestore();
      configSpy.mockRestore();
    }
  });

  it('keeps every retired management route safely unavailable without state mutation', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const player = await createAccount();
    const planet = await createPlanet(player.user.id);
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    const retired = [
      ['get', '/api/admin/dashboard'], ['get', '/api/admin/users?q=ab'], ['get', `/api/admin/users/${player.user.id}`],
      ['post', `/api/admin/users/${player.user.id}/status`], ['post', `/api/admin/users/${player.user.id}/rename`],
      ['get', '/api/admin/config'], ['post', '/api/admin/config'], ['get', '/api/admin/announcements'],
      ['post', '/api/admin/announcements'], ['delete', '/api/admin/announcements/nope'], ['delete', '/api/admin/messages/nope'],
      ['delete', '/api/admin/alliances/nope'], ['get', '/api/admin/jobs'], ['delete', '/api/admin/jobs/fleet-queue/nope'],
      ['get', '/api/admin/security-events'], ['get', '/api/admin/audit-log'], ['get', '/api/admin/health'],
    ] as const;
    for (const [method, path] of retired) {
      await request(app)[method](path).set('Cookie', admin.cookie!).set('X-Eonrover-Client', '1').send({ status: 'BANNED' })
        .expect(503, { error: 'Administrator management is not available in the read-only portal.', code: 'ADMIN_PORTAL_UNAVAILABLE' });
    }
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } })).toEqual(before);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('checks the database-backed role on every enabled request', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    await request(app).get('/api/admin/overview').set('Cookie', admin.cookie!).expect(200);
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'MODERATOR' } });
    await request(app).get('/api/admin/overview').set('Cookie', admin.cookie!).expect(403);
  });
});

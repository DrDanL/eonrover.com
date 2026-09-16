import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();
const NOW = new Date('2030-01-01T00:00:00.000Z');
let sequence = 1;

async function createAccount(options: {
  role?: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  withSession?: boolean;
} = {}) {
  const current = sequence++;
  const user = await prisma.user.create({
    data: {
      email: `admin-boundary-${current}@example.com`,
      username: `admin-boundary-${current}`,
      passwordHash: `private-hash-${current}`,
      role: options.role ?? 'PLAYER',
      status: 'ACTIVE',
      emailVerifiedAt: NOW,
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
  return prisma.planet.create({
    data: {
      ownerId,
      name: 'Read-only target',
      galaxy: 1,
      system: 1,
      slot: sequence++,
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

function privateValues(account: { id: string; passwordHash: string }, planet: { id: string }) {
  return [account.id, account.passwordHash, planet.id, 'private-session'];
}

describe('administrator portal containment', () => {
  it('requires a current ADMIN role for the only retained read-only endpoint', async () => {
    const player = await createAccount({ withSession: true });
    const moderator = await createAccount({ role: 'MODERATOR', withSession: true });
    const admin = await createAccount({ role: 'ADMIN', withSession: true });

    await request(app).get('/api/admin/status').expect(401);
    for (const actor of [player, moderator]) {
      const response = await request(app).get('/api/admin/status').set('Cookie', actor.cookie!).expect(403);
      expect(response.body).toEqual({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }

    await request(app)
      .get('/api/admin/status')
      .set('Cookie', admin.cookie!)
      .expect(200)
      .expect({ status: 'read-only' });
  });

  it('checks the database-backed role on every request', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    await request(app).get('/api/admin/status').set('Cookie', admin.cookie!).expect(200);

    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'MODERATOR' } });
    await request(app).get('/api/admin/status').set('Cookie', admin.cookie!).expect(403);
  });

  it('retires every prior management endpoint without PostgreSQL settlement or mutation', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const player = await createAccount();
    const planet = await createPlanet(player.user.id);
    const before = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } }),
      planet: await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } }),
      audit: await prisma.auditLog.count(),
      notifications: await prisma.notification.count(),
      announcements: await prisma.announcement.count(),
      missions: await prisma.fleetMission.count(),
    };

    const retired = [
      ['get', '/api/admin/dashboard'],
      ['get', '/api/admin/users?q=ab'],
      ['get', `/api/admin/users/${player.user.id}`],
      ['post', `/api/admin/users/${player.user.id}/status`],
      ['post', `/api/admin/users/${player.user.id}/rename`],
      ['get', '/api/admin/config'],
      ['post', '/api/admin/config'],
      ['get', '/api/admin/announcements'],
      ['post', '/api/admin/announcements'],
      ['delete', '/api/admin/announcements/nope'],
      ['delete', '/api/admin/messages/nope'],
      ['delete', '/api/admin/alliances/nope'],
      ['get', '/api/admin/jobs'],
      ['delete', '/api/admin/jobs/fleet-queue/nope'],
      ['get', '/api/admin/security-events'],
      ['get', '/api/admin/audit-log'],
      ['get', '/api/admin/health'],
    ] as const;

    for (const [method, path] of retired) {
      const response = await request(app)[method](path)
        .set('Cookie', admin.cookie!)
        .set('X-Eonrover-Client', '1')
        .send({ status: 'BANNED', username: 'changed', key: 'fleetSpeed', value: 99 });
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: 'Administrator management is not available in the read-only portal.',
        code: 'ADMIN_PORTAL_UNAVAILABLE',
      });
      const serialized = JSON.stringify(response.body);
      for (const value of privateValues(player.user, planet)) expect(serialized).not.toContain(value);
    }

    expect(await prisma.user.findUniqueOrThrow({ where: { id: player.user.id } })).toEqual(before.user);
    expect(await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } })).toEqual(before.planet);
    expect(await prisma.auditLog.count()).toBe(before.audit);
    expect(await prisma.notification.count()).toBe(before.notifications);
    expect(await prisma.announcement.count()).toBe(before.announcements);
    expect(await prisma.fleetMission.count()).toBe(before.missions);
  });

  it('keeps former player-state reads from synchronising production or recording audit data', async () => {
    const admin = await createAccount({ role: 'ADMIN', withSession: true });
    const player = await createAccount();
    const planet = await createPlanet(player.user.id);
    const before = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });

    await request(app)
      .get(`/api/admin/users/${player.user.id}`)
      .set('Cookie', admin.cookie!)
      .expect(503);

    const after = await prisma.planet.findUniqueOrThrow({ where: { id: planet.id } });
    expect(after).toEqual(before);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

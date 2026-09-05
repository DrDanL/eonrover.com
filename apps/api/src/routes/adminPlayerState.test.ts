import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE, sessionTokenDigest } from '../lib/auth';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { invalidateUniverseConfigCache } from '../services/gameConfig';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn(),
}));

const app = createApp();
const NOW = new Date('2026-09-06T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;
let coordinate = 1;
let accountSequence = 1;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  jest.setSystemTime(NOW);
  coordinate = 1;
  accountSequence = 1;
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(undefined);
  invalidateUniverseConfigCache();
});

afterEach(() => {
  jest.useRealTimers();
  invalidateUniverseConfigCache();
});

async function createAccount(options: {
  email?: string;
  username?: string;
  role?: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  emailVerifiedAt?: Date | null;
  protectedUntil?: Date | null;
  withSession?: boolean;
} = {}) {
  const sequence = accountSequence++;
  const user = await prisma.user.create({
    data: {
      email: options.email ?? `admin-state-${sequence}@example.com`,
      username: options.username ?? `admin-state-${sequence}`,
      passwordHash: `sensitive-password-hash-${sequence}`,
      role: options.role ?? 'PLAYER',
      status: options.status ?? 'ACTIVE',
      emailVerifiedAt: options.emailVerifiedAt === undefined ? NOW : options.emailVerifiedAt,
      protectedUntil: options.protectedUntil,
    },
  });
  if (!options.withSession) return { user, cookie: null, rawSessionToken: null };

  const rawSessionToken = `raw-sensitive-session-${sequence}`;
  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawSessionToken),
      userId: user.id,
      expiresAt: new Date(NOW.getTime() + 24 * HOUR_MS),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${rawSessionToken}`, rawSessionToken };
}

async function createPlanet(userId: string, options: {
  name?: string;
  isHomeworld?: boolean;
  lastProductionAt?: Date;
  alloy?: number;
  heliox?: number;
  aether?: number;
  alloyMine?: number;
  helioxExtractor?: number;
  solarArray?: number;
  alloyStorage?: number;
} = {}) {
  const slot = coordinate++;
  return prisma.planet.create({
    data: {
      ownerId: userId,
      name: options.name ?? `Inspection ${slot}`,
      isHomeworld: options.isHomeworld ?? false,
      galaxy: 4,
      system: 7,
      slot,
      planetType: 'TEMPERATE',
      temperature: 12,
      solarIndex: 0.7,
      alloy: options.alloy ?? 100,
      heliox: options.heliox ?? 100,
      aether: options.aether ?? 5,
      lastProductionAt: options.lastProductionAt ?? NOW,
      buildings: {
        create: [
          { key: 'alloyMine', level: options.alloyMine ?? 0 },
          { key: 'helioxExtractor', level: options.helioxExtractor ?? 0 },
          { key: 'solarArray', level: options.solarArray ?? 0 },
          { key: 'alloyStorage', level: options.alloyStorage ?? 0 },
        ],
      },
    },
  });
}

async function adminSession() {
  return createAccount({ role: 'ADMIN', withSession: true });
}

describe('administrator player-state access', () => {
  it('returns 401 for unauthenticated search and detail requests', async () => {
    const player = await createAccount();

    const search = await request(app).get('/api/admin/users').query({ q: 'player' });
    const detail = await request(app).get(`/api/admin/users/${player.user.id}`);

    expect(search.status).toBe(401);
    expect(search.body.code).toBe('UNAUTHENTICATED');
    expect(detail.status).toBe(401);
    expect(detail.body.code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 for players and moderators on both endpoints', async () => {
    const target = await createAccount();
    const player = await createAccount({ withSession: true });
    const moderator = await createAccount({ role: 'MODERATOR', withSession: true });

    for (const cookie of [player.cookie, moderator.cookie]) {
      await request(app).get('/api/admin/users').query({ q: 'admin' }).set('Cookie', cookie!).expect(403);
      await request(app).get(`/api/admin/users/${target.user.id}`).set('Cookie', cookie!).expect(403);
    }
  });

  it('searches normalised username, email, and exact ID with an explicit result allowlist', async () => {
    const admin = await adminSession();
    const target = await createAccount({ email: 'search.pilot@example.com', username: 'SearchPilot' });
    await createPlanet(target.user.id, { isHomeworld: true });

    for (const query of ['  searchpilot  ', '  SEARCH.PILOT@EXAMPLE.COM ', target.user.id]) {
      const response = await request(app)
        .get('/api/admin/users')
        .query({ q: query })
        .set('Cookie', admin.cookie!)
        .expect(200);

      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0]).toEqual({
        id: target.user.id,
        username: 'SearchPilot',
        email: 'search.pilot@example.com',
        role: 'PLAYER',
        status: 'ACTIVE',
        emailVerified: true,
        createdAt: target.user.createdAt.toISOString(),
        planetCount: 1,
      });
    }
  });

  it('uses bounded deterministic pagination and rejects unsafe query bounds', async () => {
    const admin = await adminSession();
    for (let index = 11; index >= 0; index -= 1) {
      await createAccount({
        email: `pager-${String(index).padStart(2, '0')}@example.com`,
        username: `pager-${String(index).padStart(2, '0')}`,
      });
    }

    const response = await request(app)
      .get('/api/admin/users')
      .query({ q: 'pager-', page: 2, pageSize: 5 })
      .set('Cookie', admin.cookie!)
      .expect(200);

    expect(response.body.users.map((entry: { username: string }) => entry.username)).toEqual([
      'pager-05', 'pager-06', 'pager-07', 'pager-08', 'pager-09',
    ]);
    expect(response.body.pagination).toEqual({
      page: 2,
      pageSize: 5,
      total: 12,
      totalPages: 3,
      hasPrevious: true,
      hasNext: true,
    });

    for (const query of ['', ' ', 'a', 'x'.repeat(101)]) {
      await request(app).get('/api/admin/users').query({ q: query }).set('Cookie', admin.cookie!).expect(400);
    }
    await request(app).get('/api/admin/users').query({ q: 'pager', pageSize: 51 }).set('Cookie', admin.cookie!).expect(400);
    await request(app).get('/api/admin/users').query({ q: 'pager', page: 10_001 }).set('Cookie', admin.cookie!).expect(400);
  });

  it('returns one and multiple planets with current authoritative resources, energy, storage, and buildings', async () => {
    const admin = await adminSession();
    const player = await createAccount({
      email: 'state-owner@example.com',
      username: 'state-owner',
      protectedUntil: new Date(NOW.getTime() + 48 * HOUR_MS),
      withSession: true,
    });
    await prisma.session.create({
      data: { id: sessionTokenDigest('expired-session'), userId: player.user.id, expiresAt: new Date(NOW.getTime() - 1) },
    });
    await prisma.notification.createMany({
      data: [
        { userId: player.user.id, type: 'NOTICE', message: 'Unread' },
        { userId: player.user.id, type: 'NOTICE', message: 'Read', readAt: NOW },
      ],
    });
    const homeworld = await createPlanet(player.user.id, {
      name: 'Primary',
      isHomeworld: true,
      lastProductionAt: new Date(NOW.getTime() - HOUR_MS),
      alloyMine: 1,
      helioxExtractor: 1,
      solarArray: 1,
      alloyStorage: 1,
    });
    const colony = await createPlanet(player.user.id, { name: 'Colony' });

    const response = await request(app).get(`/api/admin/users/${player.user.id}`).set('Cookie', admin.cookie!).expect(200);

    expect(response.body.player).toMatchObject({
      id: player.user.id,
      username: 'state-owner',
      planetCount: 2,
      activeSessionCount: 1,
      unreadNotificationCount: 1,
    });
    expect(response.body.planets.map((entry: { id: string }) => entry.id)).toEqual([homeworld.id, colony.id]);
    expect(response.body.planets[0]).toMatchObject({
      id: homeworld.id,
      isHomeworld: true,
      galaxy: 4,
      system: 7,
      position: 1,
      planetType: 'TEMPERATE',
      environment: { temperature: 12, solarIndex: 0.7 },
      resources: { alloy: 133, heliox: 122, aether: 5 },
      lastProductionAt: NOW.toISOString(),
      production: { alloy: 33, heliox: 22, aether: 0 },
      energy: { supply: 46.4, demand: 22, efficiency: 1 },
      storage: { alloy: 15000, heliox: 10000, aether: 10000 },
      activeConstruction: null,
    });
    expect(response.body.planets[0].buildings).toEqual([
      { key: 'alloyMine', level: 1 },
      { key: 'alloyStorage', level: 1 },
      { key: 'helioxExtractor', level: 1 },
      { key: 'solarArray', level: 1 },
    ]);
  });

  it('settles overdue construction before returning it and does not complete future construction early', async () => {
    const admin = await adminSession();
    const player = await createAccount();
    const finish = new Date(NOW.getTime() - HOUR_MS);
    const overduePlanet = await createPlanet(player.user.id, {
      name: 'Overdue',
      lastProductionAt: new Date(finish.getTime() - HOUR_MS),
    });
    const futurePlanet = await createPlanet(player.user.id, { name: 'Future' });
    const overdue = await prisma.buildQueueItem.create({
      data: {
        planetId: overduePlanet.id,
        buildingKey: 'alloyMine',
        targetLevel: 1,
        costAlloy: 60,
        costHeliox: 15,
        costAether: 0,
        startedAt: new Date(finish.getTime() - HOUR_MS),
        completesAt: finish,
      },
    });
    const future = await prisma.buildQueueItem.create({
      data: {
        planetId: futurePlanet.id,
        buildingKey: 'alloyMine',
        targetLevel: 1,
        costAlloy: 60,
        costHeliox: 15,
        costAether: 0,
        startedAt: NOW,
        completesAt: new Date(NOW.getTime() + HOUR_MS),
      },
    });

    const response = await request(app).get(`/api/admin/users/${player.user.id}`).set('Cookie', admin.cookie!).expect(200);
    const overdueState = response.body.planets.find((entry: { id: string }) => entry.id === overduePlanet.id);
    const futureState = response.body.planets.find((entry: { id: string }) => entry.id === futurePlanet.id);

    expect(overdueState.resources.alloy).toBeCloseTo(133, 10);
    expect(overdueState.buildings).toEqual(expect.arrayContaining([{ key: 'alloyMine', level: 1 }]));
    expect(overdueState.activeConstruction).toBeNull();
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe('COMPLETE');
    expect(futureState.buildings).toEqual(expect.arrayContaining([{ key: 'alloyMine', level: 0 }]));
    expect(futureState.activeConstruction).toEqual({
      buildingKey: 'alloyMine',
      targetLevel: 1,
      status: 'PENDING',
      startedAt: NOW.toISOString(),
      completesAt: new Date(NOW.getTime() + HOUR_MS).toISOString(),
    });
    expect((await prisma.buildQueueItem.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('PENDING');
  });

  it('returns 404 without an audit record for a missing player', async () => {
    const admin = await adminSession();
    const response = await request(app)
      .get('/api/admin/users/00000000-0000-0000-0000-000000000000')
      .set('Cookie', admin.cookie!);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Player not found', code: 'NOT_FOUND' });
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('prevents a suspended administrator session from retaining access', async () => {
    const admin = await adminSession();
    await prisma.user.update({ where: { id: admin.user.id }, data: { status: 'SUSPENDED' } });

    const response = await request(app).get('/api/admin/users').query({ q: 'state' }).set('Cookie', admin.cookie!);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACCOUNT_UNAVAILABLE');
    expect(await prisma.session.count({ where: { userId: admin.user.id } })).toBe(0);
  });

  it('does not expose credentials or internal token fields and records exactly one safe audit per explicit detail open', async () => {
    const admin = await adminSession();
    const player = await createAccount({ email: 'private-player@example.com', username: 'private-player', withSession: true });
    await createPlanet(player.user.id, { isHomeworld: true });
    await prisma.verificationToken.createMany({
      data: [
        {
          userId: player.user.id,
          token: 'sensitive-email-verification-token',
          type: 'EMAIL_VERIFY',
          expiresAt: new Date(NOW.getTime() + HOUR_MS),
        },
        {
          userId: player.user.id,
          token: 'sensitive-password-reset-token',
          type: 'PASSWORD_RESET',
          expiresAt: new Date(NOW.getTime() + HOUR_MS),
        },
      ],
    });

    await request(app).get('/api/admin/users').query({ q: 'private-player' }).set('Cookie', admin.cookie!).expect(200);
    await request(app).get('/api/admin/users').query({ q: 'private-player' }).set('Cookie', admin.cookie!).expect(200);
    expect(await prisma.auditLog.count()).toBe(0);

    const response = await request(app).get(`/api/admin/users/${player.user.id}`).set('Cookie', admin.cookie!).expect(200);
    const serialized = JSON.stringify(response.body);
    for (const sensitiveValue of [
      player.user.passwordHash,
      player.rawSessionToken!,
      sessionTokenDigest(player.rawSessionToken!),
      'sensitive-email-verification-token',
      'sensitive-password-reset-token',
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
    for (const forbiddenKey of ['passwordHash', 'sessions', 'verificationTokens', 'resetToken', 'token', 'jobId']) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }

    const audits = await prisma.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: admin.user.id,
      targetType: 'User',
      targetId: player.user.id,
      action: 'PLAYER_STATE_VIEWED',
      metadata: null,
    });
  });

  it('does not allow public registration to assign an administrator role or add a new mutation route', async () => {
    await request(app)
      .post('/api/auth/register')
      .set('X-Eonrover-Client', '1')
      .send({
        email: 'role-injection@example.com',
        username: 'role-injection',
        password: 'Password123',
        role: 'ADMIN',
        status: 'ACTIVE',
      })
      .expect(201);
    const registered = await prisma.user.findUniqueOrThrow({ where: { email: 'role-injection@example.com' } });
    expect(registered.role).toBe('PLAYER');
    expect(registered.status).toBe('PENDING_VERIFICATION');

    const admin = await adminSession();
    await request(app)
      .post(`/api/admin/users/${registered.id}`)
      .set('Cookie', admin.cookie!)
      .set('X-Eonrover-Client', '1')
      .send({ status: 'BANNED' })
      .expect(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: registered.id } })).status).toBe('PENDING_VERIFICATION');
  });
});

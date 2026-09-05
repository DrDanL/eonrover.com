import { AccountStatus } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../app';
import * as authHelpers from '../lib/auth';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionTokenDigest,
} from '../lib/auth';
import { prisma } from '../lib/prisma';
import { ERROR_CODES } from '../middleware/error';

const app = createApp();
const PASSWORD = 'Password123';
let passwordHash: string;

interface TestUserOptions {
  email?: string;
  username?: string;
  status?: AccountStatus;
  emailVerifiedAt?: Date | null;
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

async function createTestUser(options: TestUserOptions = {}) {
  const status = options.status ?? 'ACTIVE';
  return prisma.user.create({
    data: {
      email: options.email ?? 'pilot@example.com',
      username: options.username ?? 'pilot',
      passwordHash,
      status,
      emailVerifiedAt:
        options.emailVerifiedAt === undefined
          ? status === 'PENDING_VERIFICATION'
            ? null
            : new Date()
          : options.emailVerifiedAt,
    },
  });
}

function post(path: string) {
  return request(app).post(path).set('X-Eonrover-Client', '1');
}

function readSessionCookie(response: request.Response): { header: string; pair: string; rawToken: string } {
  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('Expected a session cookie');

  const pair = header.split(';', 1)[0];
  const rawToken = decodeURIComponent(pair.slice(`${SESSION_COOKIE}=`.length));
  return { header, pair, rawToken };
}

async function login(email = 'pilot@example.com', password = PASSWORD) {
  return post('/api/auth/login').send({ email, password });
}

describe('Stage 2C login and database sessions', () => {
  it('normalises surrounding whitespace in the login email', async () => {
    await createTestUser();

    const response = await login('  pilot@example.com  ');

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('pilot@example.com');
  });

  it('normalises login email casing', async () => {
    await createTestUser();

    const response = await login('PiLoT@ExAmPlE.CoM');

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('pilot@example.com');
  });

  it('returns the identical generic response for unknown email and wrong password', async () => {
    await createTestUser();

    const unknown = await login('unknown@example.com', 'WrongPassword');
    const incorrect = await login('pilot@example.com', 'WrongPassword');

    expect(unknown.status).toBe(401);
    expect(incorrect.status).toBe(unknown.status);
    expect(incorrect.body).toEqual(unknown.body);
    expect(unknown.body).toEqual({
      error: 'Invalid email or password.',
      code: ERROR_CODES.INVALID_CREDENTIALS,
    });
    expect(unknown.headers['set-cookie']).toBeUndefined();
    expect(incorrect.headers['set-cookie']).toBeUndefined();
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it('performs a fixed dummy-hash comparison when the email is unknown', async () => {
    const comparison = jest.spyOn(authHelpers, 'verifyPassword');

    try {
      const response = await login('nobody@example.com', 'WrongPassword');

      expect(response.status).toBe(401);
      expect(comparison).toHaveBeenCalledWith('WrongPassword', DUMMY_PASSWORD_HASH);
    } finally {
      comparison.mockRestore();
    }
  });

  it('does not create a session or cookie for an unverified user', async () => {
    await createTestUser({ status: 'PENDING_VERIFICATION', emailVerifiedAt: null });

    const response = await login();

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Please verify your email before signing in.',
      code: ERROR_CODES.EMAIL_NOT_VERIFIED,
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it.each<AccountStatus>(['SUSPENDED', 'BANNED'])(
    'does not create a session or cookie for a %s user',
    async (status) => {
      await createTestUser({ status });

      const response = await login();

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'This account is unavailable.',
        code: ERROR_CODES.ACCOUNT_UNAVAILABLE,
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      await expect(prisma.session.count()).resolves.toBe(0);
    },
  );

  it('creates one expiring digest-backed session whose raw cookie authenticates', async () => {
    const before = Date.now();
    await createTestUser();

    const response = await login();

    expect(response.status).toBe(200);
    const { header, pair, rawToken } = readSessionCookie(response);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionTokenDigest(rawToken) } });

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.id).not.toBe(rawToken);
    expect(session.id).toBe(sessionTokenDigest(rawToken));
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS);
    await expect(prisma.session.count()).resolves.toBe(1);

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    expect(JSON.stringify(response.body)).not.toContain(rawToken);
    expect(JSON.stringify(response.body)).not.toContain(session.id);
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);

    const me = await request(app).get('/api/auth/me').set('Cookie', pair);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('pilot@example.com');
  });

  it('generates a different token and stored digest for every successful login', async () => {
    await createTestUser();

    const first = readSessionCookie(await login());
    const second = readSessionCookie(await login());

    expect(first.rawToken).not.toBe(second.rawToken);
    expect(sessionTokenDigest(first.rawToken)).not.toBe(sessionTokenDigest(second.rawToken));
    await expect(prisma.session.count()).resolves.toBe(2);
  });

  it('upgrades a valid legacy plaintext session in place on use', async () => {
    const user = await createTestUser();
    const rawToken = 'legacy-plaintext-session';
    const createdAt = new Date(Date.now() - 10_000);
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.session.create({
      data: { id: rawToken, userId: user.id, createdAt, expiresAt },
    });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${rawToken}`);

    expect(response.status).toBe(200);
    await expect(prisma.session.findUnique({ where: { id: rawToken } })).resolves.toBeNull();
    const upgraded = await prisma.session.findUniqueOrThrow({ where: { id: sessionTokenDigest(rawToken) } });
    expect(upgraded.createdAt).toEqual(createdAt);
    expect(upgraded.expiresAt).toEqual(expiresAt);
    await expect(prisma.session.count()).resolves.toBe(1);
  });

  it('rejects expired and invalid sessions with the same response and clears their cookies', async () => {
    const user = await createTestUser();
    const expiredRawToken = 'expired-session-token';
    await prisma.session.create({
      data: {
        id: sessionTokenDigest(expiredRawToken),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const expired = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${expiredRawToken}`);
    const invalid = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=not-a-session`);

    expect(expired.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(expired.body).toEqual(invalid.body);
    expect(expired.body).toEqual({ error: 'Not authenticated', code: ERROR_CODES.UNAUTHENTICATED });
    expect(readSessionCookie(expired).rawToken).toBe('');
    expect(readSessionCookie(invalid).rawToken).toBe('');
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it('stops an existing session from authorising after the user is suspended', async () => {
    const user = await createTestUser();
    const sessionCookie = readSessionCookie(await login());
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const response = await request(app).get('/api/auth/me').set('Cookie', sessionCookie.pair);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'This account is unavailable.',
      code: ERROR_CODES.ACCOUNT_UNAVAILABLE,
    });
    expect(readSessionCookie(response).rawToken).toBe('');
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it('logs out safely, revokes the presented session and clears its cookie', async () => {
    await createTestUser();
    const sessionCookie = readSessionCookie(await login());

    const response = await post('/api/auth/logout').set('Cookie', sessionCookie.pair).send({});

    expect(response.status).toBe(200);
    expect(readSessionCookie(response).rawToken).toBe('');
    await expect(prisma.session.findUnique({ where: { id: sessionTokenDigest(sessionCookie.rawToken) } })).resolves.toBeNull();
    await request(app).get('/api/auth/me').set('Cookie', sessionCookie.pair).expect(401);
    await post('/api/auth/logout').set('Cookie', sessionCookie.pair).send({}).expect(200);
    await post('/api/auth/logout').send({}).expect(200);
  });

  it('ordinary logout leaves other device sessions valid', async () => {
    await createTestUser();
    const first = readSessionCookie(await login());
    const second = readSessionCookie(await login());

    await post('/api/auth/logout').set('Cookie', first.pair).send({}).expect(200);

    await expect(prisma.session.findUnique({ where: { id: sessionTokenDigest(first.rawToken) } })).resolves.toBeNull();
    await expect(prisma.session.findUnique({ where: { id: sessionTokenDigest(second.rawToken) } })).resolves.not.toBeNull();
    await request(app).get('/api/auth/me').set('Cookie', second.pair).expect(200);
  });

  it('continues revoking every user session after a password reset', async () => {
    const user = await createTestUser();
    const passwordResetToken = 'existing-raw-password-reset-token';
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: passwordResetToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.session.createMany({
      data: [
        { id: sessionTokenDigest('device-one'), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        { id: sessionTokenDigest('device-two'), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
      ],
    });

    const response = await post('/api/auth/reset-password').send({
      token: passwordResetToken,
      password: 'ReplacementPassword123',
    });

    expect(response.status).toBe(200);
    await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
    const usedToken = await prisma.verificationToken.findUniqueOrThrow({ where: { token: passwordResetToken } });
    expect(usedToken.usedAt).not.toBeNull();
  });

  it('does not write credential or session material to responses or console logs', async () => {
    await createTestUser();
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    try {
      const failed = await login('pilot@example.com', 'HighlySensitiveWrongPassword');
      const successful = await login();
      const sessionCookie = readSessionCookie(successful);
      const storedDigest = sessionTokenDigest(sessionCookie.rawToken);
      const bodies = JSON.stringify([failed.body, successful.body]);

      expect(bodies).not.toContain('HighlySensitiveWrongPassword');
      expect(bodies).not.toContain(PASSWORD);
      expect(bodies).not.toContain(passwordHash);
      expect(bodies).not.toContain(sessionCookie.rawToken);
      expect(bodies).not.toContain(storedDigest);

      const logs = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
      expect(logs).not.toContain('HighlySensitiveWrongPassword');
      expect(logs).not.toContain(PASSWORD);
      expect(logs).not.toContain(passwordHash);
      expect(logs).not.toContain(sessionCookie.rawToken);
      expect(logs).not.toContain(storedDigest);
      expect(logs).not.toContain(`${SESSION_COOKIE}=`);
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });
});

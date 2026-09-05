import request from 'supertest';
import { createApp } from '../app';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { ERROR_CODES } from '../middleware/error';
import {
  EMAIL_VERIFICATION_TTL_MS,
  emailVerificationTokenStorageValue,
  VERIFICATION_RESEND_COOLDOWN_MS,
} from '../services/emailVerificationService';
import { verificationTokenFromMail } from '../testUtils/verificationMail';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn(),
}));

const app = createApp();
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;
const csrfHeader = { 'X-Eonrover-Client': '1' };
const acceptedResponse = {
  message: 'If an unverified account exists for that email address, a verification message will be sent.',
};

function register(email: string, username: string) {
  return request(app)
    .post('/api/auth/register')
    .set(csrfHeader)
    .send({ email, username, password: 'Password123' });
}

function resend(email: string) {
  return request(app)
    .post('/api/auth/resend-verification')
    .set(csrfHeader)
    .send({ email });
}

function verify(token: string) {
  return request(app)
    .post('/api/auth/verify-email')
    .set(csrfHeader)
    .send({ token });
}

async function makeVerificationTokenEligibleForResend(userId: string): Promise<void> {
  await prisma.verificationToken.updateMany({
    where: { userId, type: 'EMAIL_VERIFY', usedAt: null },
    data: { createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1_000) },
  });
}

async function createPendingUser(email: string, username: string) {
  return prisma.user.create({ data: { email, username, passwordHash: 'not-used' } });
}

beforeEach(() => {
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(undefined);
});

describe('recoverable email verification', () => {
  it('returns the delivery-aware registration contract and stores only a token digest', async () => {
    const response = await register('delivery@example.com', 'delivery1').expect(201, {
      message: 'Registered. Check your email to verify your account.',
      requiresVerification: true,
      verificationEmailSent: true,
    });

    const rawToken = verificationTokenFromMail(mockedSendMail.mock.calls, 'delivery@example.com');
    const stored = await prisma.verificationToken.findFirstOrThrow({
      where: { user: { email: 'delivery@example.com' }, type: 'EMAIL_VERIFY' },
    });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.token).toBe(emailVerificationTokenStorageValue(rawToken));
    expect(stored.token).not.toBe(rawToken);
    expect(response.text).not.toContain(rawToken);
  });

  it('returns 201 with recovery guidance and preserves committed records when registration mail fails', async () => {
    mockedSendMail.mockRejectedValueOnce(new Error('smtp-provider-secret verification-raw-token'));

    const response = await register('failed-delivery@example.com', 'failed_delivery').expect(201, {
      message:
        'Your account was created, but the verification email could not be sent. Please request another verification email.',
      requiresVerification: true,
      verificationEmailSent: false,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'failed-delivery@example.com' } });
    expect(await prisma.planet.count({ where: { ownerId: user.id } })).toBe(1);
    expect(await prisma.verificationToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFY' } })).toBe(1);
    expect(response.text).not.toMatch(/smtp-provider-secret|verification-raw-token|Prisma|constraint/i);
  });

  it('rotates an eligible token, invalidates the old link, and verifies with the replacement', async () => {
    await register('rotate@example.com', 'rotate1').expect(201);
    const oldRawToken = verificationTokenFromMail(mockedSendMail.mock.calls, 'rotate@example.com');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'rotate@example.com' } });
    await makeVerificationTokenEligibleForResend(user.id);
    mockedSendMail.mockClear();
    const beforeResend = Date.now();

    const resendResponse = await resend('  ROTATE@EXAMPLE.COM  ').expect(202, acceptedResponse);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedSendMail.mock.calls[0][0]).toBe('rotate@example.com');
    const replacementRawToken = verificationTokenFromMail(mockedSendMail.mock.calls, 'rotate@example.com');
    expect(replacementRawToken).not.toBe(oldRawToken);
    expect(resendResponse.text).not.toContain(replacementRawToken);

    expect(
      await prisma.verificationToken.findUnique({
        where: { token: emailVerificationTokenStorageValue(oldRawToken) },
      }),
    ).toBeNull();
    const replacementRecord = await prisma.verificationToken.findUniqueOrThrow({
      where: { token: emailVerificationTokenStorageValue(replacementRawToken) },
    });
    expect(replacementRecord.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeResend + EMAIL_VERIFICATION_TTL_MS,
    );
    expect(replacementRecord.expiresAt.getTime()).toBeLessThanOrEqual(
      beforeResend + EMAIL_VERIFICATION_TTL_MS + 5_000,
    );

    await verify(oldRawToken).expect(400, {
      error: 'Invalid or expired token',
      code: ERROR_CODES.BAD_REQUEST,
    });
    await verify(replacementRawToken).expect(200, {
      message: 'Email verified. You can now sign in.',
    });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      status: 'ACTIVE',
      emailVerifiedAt: expect.any(Date),
    });
  });

  it('returns the same response and sends nothing for unknown and already-verified accounts', async () => {
    const unknown = await resend('unknown@example.com').expect(202, acceptedResponse);

    await register('verified@example.com', 'verified1').expect(201);
    const token = verificationTokenFromMail(mockedSendMail.mock.calls, 'verified@example.com');
    await verify(token).expect(200);
    mockedSendMail.mockClear();

    const verified = await resend('verified@example.com').expect(202, acceptedResponse);

    expect(verified.body).toEqual(unknown.body);
    expect(verified.status).toBe(unknown.status);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('returns the generic response without rotating or mailing during the cooldown', async () => {
    await register('cooldown@example.com', 'cooldown1').expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'cooldown@example.com' } });
    const original = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    mockedSendMail.mockClear();

    await resend('cooldown@example.com').expect(202, acceptedResponse);

    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(await prisma.verificationToken.findMany({ where: { userId: user.id } })).toEqual([original]);
  });

  it('allows only one concurrent attempt to consume a verification token', async () => {
    await register('concurrent@example.com', 'concurrent1').expect(201);
    const rawToken = verificationTokenFromMail(mockedSendMail.mock.calls, 'concurrent@example.com');

    const responses = await Promise.all([verify(rawToken), verify(rawToken)]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'concurrent@example.com' } });
    const token = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(user.status).toBe('ACTIVE');
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(token.usedAt).not.toBeNull();
  });

  it('rotates and sends only once for concurrent resend requests', async () => {
    await register('concurrent-resend@example.com', 'concurrent_resend').expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'concurrent-resend@example.com' },
    });
    await makeVerificationTokenEligibleForResend(user.id);
    mockedSendMail.mockClear();

    const responses = await Promise.all([
      resend('concurrent-resend@example.com'),
      resend('concurrent-resend@example.com'),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([202, 202]);
    expect(responses.map(({ body }) => body)).toEqual([acceptedResponse, acceptedResponse]);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(
      await prisma.verificationToken.count({
        where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
      }),
    ).toBe(1);
  });

  it('keeps expired and already-used tokens invalid', async () => {
    const expiredUser = await createPendingUser('expired@example.com', 'expired1');
    const expiredRawToken = 'expired-verification-token';
    await prisma.verificationToken.create({
      data: {
        userId: expiredUser.id,
        token: emailVerificationTokenStorageValue(expiredRawToken),
        type: 'EMAIL_VERIFY',
        createdAt: new Date(Date.now() - EMAIL_VERIFICATION_TTL_MS - 1_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const usedUser = await createPendingUser('used@example.com', 'used_token');
    const usedRawToken = 'used-verification-token';
    await prisma.verificationToken.create({
      data: {
        userId: usedUser.id,
        token: emailVerificationTokenStorageValue(usedRawToken),
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        usedAt: new Date(),
      },
    });

    await verify(expiredRawToken).expect(400, {
      error: 'Invalid or expired token',
      code: ERROR_CODES.BAD_REQUEST,
    });
    await verify(usedRawToken).expect(400, {
      error: 'Invalid or expired token',
      code: ERROR_CODES.BAD_REQUEST,
    });
  });

});

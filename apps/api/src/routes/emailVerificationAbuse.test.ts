import request from 'supertest';
import { createApp } from '../app';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import {
  EMAIL_VERIFICATION_TTL_MS,
  emailVerificationTokenStorageValue,
  VERIFICATION_RESEND_COOLDOWN_MS,
} from '../services/emailVerificationService';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn(),
}));

const app = createApp();
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;
const acceptedResponse = {
  message: 'If an unverified account exists for that email address, a verification message will be sent.',
};

function resend(email: string) {
  return request(app)
    .post('/api/auth/resend-verification')
    .set('X-Eonrover-Client', '1')
    .send({ email });
}

async function createEligiblePendingUser(email: string, username: string, rawToken: string) {
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'not-used' } });
  const storedToken = emailVerificationTokenStorageValue(rawToken);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      token: storedToken,
      type: 'EMAIL_VERIFY',
      createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1_000),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });
  return { user, storedToken };
}

beforeEach(() => {
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(undefined);
});

describe('verification resend abuse boundaries', () => {
  it('keeps resend mail failures and account existence out of responses and logs', async () => {
    const { user } = await createEligiblePendingUser(
      'mail-error@example.com',
      'mail_error',
      'old-token-not-returned',
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedSendMail.mockRejectedValueOnce(
      new Error('private.smtp.example token=mailer-secret database=registered-user'),
    );

    const response = await resend('mail-error@example.com').expect(202, acceptedResponse);

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(response.text).not.toMatch(/mail-error@example|private\.smtp|mailer-secret|registered-user|sha256/i);
    expect(consoleError).not.toHaveBeenCalled();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.verificationToken.count({ where: { userId: user.id } })).toBe(1);
    consoleError.mockRestore();
  });

  it('keeps the generic response when the shared authentication rate limit is reached', async () => {
    const { storedToken } = await createEligiblePendingUser(
      'rate-limited@example.com',
      'rate_limited',
      'rate-limit-old-token',
    );

    for (let requestNumber = 1; requestNumber <= 20; requestNumber += 1) {
      await resend(`limit-probe-${requestNumber}@example.com`).expect(202, acceptedResponse);
    }
    await resend('rate-limited@example.com').expect(202, acceptedResponse);

    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(await prisma.verificationToken.findUnique({ where: { token: storedToken } })).not.toBeNull();
  });
});

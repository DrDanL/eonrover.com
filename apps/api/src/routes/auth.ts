import { Response, Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { getApiConfig } from '../config';
import { prisma } from '../lib/prisma';
import {
  clearSessionCookie,
  createSession,
  DUMMY_PASSWORD_HASH,
  generateToken,
  revokePresentedSession,
  SESSION_COOKIE,
  verifyPassword,
  hashPassword,
} from '../lib/auth';
import { passwordResetEmailHtml, sendMail, verificationEmailHtml } from '../lib/mailer';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, rateLimitErrorHandler, sendError, sendValidationError } from '../middleware/error';
import { getUniverseConfig } from '../services/gameConfig';
import {
  consumeEmailVerificationToken,
  generateEmailVerificationToken,
  rotateEmailVerificationToken,
} from '../services/emailVerificationService';
import { provisionRegistration } from '../services/registrationService';

const config = getApiConfig();
const router = Router();

const RESEND_ACCEPTED_MESSAGE =
  'If an unverified account exists for that email address, a verification message will be sent.';

function sendResendAccepted(res: Response): void {
  res.status(202).json({ message: RESEND_ACCEPTED_MESSAGE });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    if (req.path === '/resend-verification') {
      sendResendAccepted(res);
      return;
    }
    rateLimitErrorHandler(req, res, next);
  },
});

const registerSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, - and _ are allowed'),
  password: z.string().min(8).max(128),
});

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, username, password } = parsed.data;

  const passwordHash = await hashPassword(password);
  const universeConfig = await getUniverseConfig();
  const registration = await provisionRegistration({
    email,
    username,
    passwordHash,
    verificationToken: generateEmailVerificationToken(),
    protectionHours: universeConfig.newPlayerProtectionHours,
    now: new Date(),
  });

  const link = `${config.webUrl}/verify-email?token=${registration.verificationToken}`;
  try {
    await sendMail(email, 'Verify your Eon Rover account', verificationEmailHtml(link));
  } catch {
    res.status(201).json({
      message:
        'Your account was created, but the verification email could not be sent. Please request another verification email.',
      requiresVerification: true,
      verificationEmailSent: false,
    });
    return;
  }

  res.status(201).json({
    message: 'Registered. Check your email to verify your account.',
    requiresVerification: true,
    verificationEmailSent: true,
  });
}));

router.post('/resend-verification', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const replacement = await rotateEmailVerificationToken(parsed.data.email);
  if (replacement) {
    const link = `${config.webUrl}/verify-email?token=${replacement.rawToken}`;
    await sendMail(
      replacement.email,
      'Verify your Eon Rover account',
      verificationEmailHtml(link),
    ).catch(() => undefined);
  }

  sendResendAccepted(res);
}));

router.post('/verify-email', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({ token: z.string().min(1).max(512) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  await consumeEmailVerificationToken(parsed.data.token, new Date());
  res.json({ message: 'Email verified. You can now sign in.' });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) {
    await prisma.securityEvent.create({
      data: { type: 'LOGIN_FAILED', metadata: { email }, ipAddress: req.ip },
    });
    sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
    return;
  }

  if (!user.emailVerifiedAt || user.status === 'PENDING_VERIFICATION') {
    sendError(res, 403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Please verify your email before signing in.');
    return;
  }

  if (user.status !== 'ACTIVE') {
    sendError(res, 403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, req, res);
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE];
  if (typeof rawToken === 'string') {
    await revokePresentedSession(rawToken);
  }
  clearSessionCookie(res);
  res.json({ message: 'Logged out' });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    const token = generateToken();
    await prisma.verificationToken.create({
      data: { userId: user.id, token, type: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + 3600 * 1000) },
    });
    const link = `${config.webUrl}/reset-password?token=${token}`;
    await sendMail(user.email, 'Reset your Eon Rover password', passwordResetEmailHtml(link)).catch(() => undefined);
  }
  // Always respond the same way to avoid leaking which emails are registered.
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
}));

router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({ token: z.string(), password: z.string().min(8).max(128) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const record = await prisma.verificationToken.findUnique({ where: { token: parsed.data.token } });
  if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Invalid or expired token');
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  res.json({ message: 'Password updated. Please sign in again.' });
}));

export default router;

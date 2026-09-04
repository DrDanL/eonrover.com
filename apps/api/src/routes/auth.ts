import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { DEFAULT_UNIVERSE_CONFIG, PLANET_TYPES, STARTING_RESOURCES } from '@eonrover/shared';
import { getApiConfig } from '../config';
import { prisma } from '../lib/prisma';
import { clearSessionCookie, createSession, generateToken, hashPassword, verifyPassword } from '../lib/auth';
import { passwordResetEmailHtml, sendMail, verificationEmailHtml } from '../lib/mailer';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, rateLimitErrorHandler, sendError, sendValidationError } from '../middleware/error';

const config = getApiConfig();
const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
});

const registerSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, - and _ are allowed'),
  password: z.string().min(8).max(128),
});

const PLANET_TYPE_KEYS = Object.keys(PLANET_TYPES) as Array<keyof typeof PLANET_TYPES>;
const PLANET_TYPE_TO_DB: Record<string, string> = {
  temperate: 'TEMPERATE',
  volcanic: 'VOLCANIC',
  ice: 'ICE',
  gasGiant: 'GAS_GIANT',
  barren: 'BARREN',
  oceanic: 'OCEANIC',
};

function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

async function findFreeSlot(): Promise<{ galaxy: number; system: number; slot: number }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const galaxy = 1 + Math.floor(Math.random() * 6);
    const system = 1 + Math.floor(Math.random() * 400);
    const slot = 1 + Math.floor(Math.random() * 12);
    const existing = await prisma.planet.findUnique({ where: { galaxy_system_slot: { galaxy, system, slot } } });
    if (!existing) return { galaxy, system, slot };
  }
  throw new Error('Could not find a free planet slot, galaxy is full');
}

const STARTER_BUILDINGS = ['alloyMine', 'helioxExtractor', 'solarArray'];

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, username, password } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    sendError(res, 409, ERROR_CODES.CONFLICT, 'Email or username already in use');
    return;
  }

  const passwordHash = await hashPassword(password);
  const protectedUntil = new Date(Date.now() + DEFAULT_UNIVERSE_CONFIG.newPlayerProtectionHours * 3600 * 1000);

  const user = await prisma.user.create({
    data: { email, username, passwordHash, protectedUntil },
  });

  const planetTypeKey = PLANET_TYPE_KEYS[Math.floor(Math.random() * PLANET_TYPE_KEYS.length)];
  const profile = PLANET_TYPES[planetTypeKey];
  const { galaxy, system, slot } = await findFreeSlot();

  await prisma.planet.create({
    data: {
      ownerId: user.id,
      name: `${username}'s Homeworld`,
      isHomeworld: true,
      galaxy,
      system,
      slot,
      planetType: PLANET_TYPE_TO_DB[planetTypeKey] as never,
      temperature: randomInRange(profile.temperatureRange),
      solarIndex: profile.solarIndexRange[0] + Math.random() * (profile.solarIndexRange[1] - profile.solarIndexRange[0]),
      alloy: STARTING_RESOURCES.alloy,
      heliox: STARTING_RESOURCES.heliox,
      aether: STARTING_RESOURCES.aether,
      buildings: { create: STARTER_BUILDINGS.map((key) => ({ key, level: key === 'solarArray' ? 1 : 0 })) },
    },
  });

  const token = generateToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      token,
      type: 'EMAIL_VERIFY',
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  const link = `${config.webUrl}/verify-email?token=${token}`;
  await sendMail(email, 'Verify your Eon Rover account', verificationEmailHtml(link)).catch(() => undefined);

  res.status(201).json({ message: 'Registered. Check your email to verify your account.' });
}));

router.post('/verify-email', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({ token: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const record = await prisma.verificationToken.findUnique({ where: { token: parsed.data.token } });
  if (!record || record.type !== 'EMAIL_VERIFY' || record.usedAt || record.expiresAt < new Date()) {
    sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'Invalid or expired token');
    return;
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  res.json({ message: 'Email verified. You can now sign in.' });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await prisma.securityEvent.create({
      data: { type: 'LOGIN_FAILED', metadata: { email }, ipAddress: req.ip },
    });
    sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Invalid credentials');
    return;
  }
  if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
    sendError(res, 403, ERROR_CODES.FORBIDDEN, 'This account is not active');
    return;
  }
  if (user.status === 'PENDING_VERIFICATION') {
    sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Please verify your email before signing in');
    return;
  }
  await createSession(user.id, req, res);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined);
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

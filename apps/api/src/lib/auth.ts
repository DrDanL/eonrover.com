import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { CookieOptions, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getApiConfig } from '../config';
import { prisma } from './prisma';

const config = getApiConfig();

export const SESSION_COOKIE = 'eonrover_sid';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const SESSION_DIGEST_PREFIX = 'sha256:';
const MAX_PRESENTED_SESSION_TOKEN_LENGTH = 512;

// Precomputed bcrypt hash used to equalise the password-comparison path for
// unknown accounts. It is intentionally fixed and never generated per request.
export const DUMMY_PASSWORD_HASH = '$2a$12$zwc6x4wc4pwvQLoOD8agI.Pemu7pE.IBfPKOJnSsf.J92fLdBEau.';

type SessionWithUser = Prisma.SessionGetPayload<{ include: { user: true } }>;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function isSecureCookies(): boolean {
  return config.secureCookies;
}

export function sessionTokenDigest(token: string): string {
  return `${SESSION_DIGEST_PREFIX}${createHash('sha256').update(token).digest('hex')}`;
}

export function isUserPermittedToSignIn(user: { status: string; emailVerifiedAt: Date | null }): boolean {
  return user.status === 'ACTIVE' && user.emailVerifiedAt !== null;
}

function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookies(),
    path: '/',
  };
}

export async function createSession(userId: string, req: Request, res: Response): Promise<void> {
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      id: sessionTokenDigest(rawToken),
      userId,
      expiresAt,
      userAgent: req.headers['user-agent']?.slice(0, 255),
      ipAddress: req.ip,
    },
  });

  res.cookie(SESSION_COOKIE, rawToken, {
    ...sessionCookieOptions(),
    maxAge: SESSION_TTL_MS,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

/**
 * Temporary Stage 2C compatibility for sessions created before token digests
 * were introduced. Remove once every possible 14-day legacy session is stale.
 */
export async function resolveSessionToken(rawToken: string, now = new Date()): Promise<SessionWithUser | null> {
  if (!rawToken || rawToken.length > MAX_PRESENTED_SESSION_TOKEN_LENGTH) return null;

  const digest = sessionTokenDigest(rawToken);
  const current = await prisma.session.findUnique({ where: { id: digest }, include: { user: true } });
  if (current) return current;

  // A stored digest must never itself be accepted as a bearer token.
  if (rawToken.startsWith(SESSION_DIGEST_PREFIX)) return null;

  const legacy = await prisma.session.findUnique({ where: { id: rawToken }, include: { user: true } });
  if (!legacy) return null;

  if (legacy.expiresAt <= now || !isUserPermittedToSignIn(legacy.user)) return legacy;

  try {
    return await prisma.session.update({
      where: { id: legacy.id },
      data: { id: digest },
      include: { user: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025'].includes(error.code)) {
      return prisma.session.findUnique({ where: { id: digest }, include: { user: true } });
    }
    throw error;
  }
}

export async function revokePresentedSession(rawToken: string): Promise<void> {
  if (!rawToken || rawToken.length > MAX_PRESENTED_SESSION_TOKEN_LENGTH) return;

  const ids = [sessionTokenDigest(rawToken)];
  if (!rawToken.startsWith(SESSION_DIGEST_PREFIX)) ids.push(rawToken);
  await prisma.session.deleteMany({ where: { id: { in: ids } } });
}

export function generateToken(): string {
  return uuid() + uuid();
}

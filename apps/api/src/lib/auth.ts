import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'eonrover_sid';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function isSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
}

export async function createSession(userId: string, req: Request, res: Response): Promise<void> {
  const session = await prisma.session.create({
    data: {
      id: uuid(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: req.headers['user-agent']?.slice(0, 255),
      ipAddress: req.ip,
    },
  });
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookies(),
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function generateToken(): string {
  return uuid() + uuid();
}

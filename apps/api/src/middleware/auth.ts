import { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE } from '../lib/auth';
import { asyncHandler, ERROR_CODES, sendError } from './error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        username: string;
        role: 'PLAYER' | 'MODERATOR' | 'ADMIN';
        status: string;
      };
      sessionId?: string;
    }
  }
}

export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) {
    sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Not authenticated');
    return;
  }
  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) {
    sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Session expired');
    return;
  }
  if (session.user.status === 'SUSPENDED' || session.user.status === 'BANNED') {
    sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Account is suspended');
    return;
  }
  req.user = {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    role: session.user.role,
    status: session.user.status,
  };
  req.sessionId = session.id;
  prisma.user.update({ where: { id: session.user.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
  next();
});

export function requireRole(...roles: Array<'MODERATOR' | 'ADMIN'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role as 'MODERATOR' | 'ADMIN')) {
      sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Insufficient permissions');
      return;
    }
    next();
  };
}

/** Simple CSRF mitigation: mutating requests must carry a custom header that
 * cannot be set by a simple cross-site form submission. */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  if (req.headers['x-eonrover-client'] !== '1') {
    sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Missing CSRF header');
    return;
  }
  next();
}

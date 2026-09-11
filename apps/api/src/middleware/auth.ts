import { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  clearSessionCookie,
  isUserPermittedToSignIn,
  resolveSessionToken,
  SESSION_COOKIE,
} from '../lib/auth';
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

function authenticatedRequest(options: { updateLastActiveAt: boolean; revokeInvalidSession: boolean; upgradeLegacySession: boolean }): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawToken = req.cookies?.[SESSION_COOKIE];
    if (typeof rawToken !== 'string' || !rawToken) {
      sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Not authenticated');
      return;
    }

    const now = new Date();
    const session = await resolveSessionToken(rawToken, now, options.upgradeLegacySession);
    if (!session) {
      clearSessionCookie(res);
      sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Not authenticated');
      return;
    }

    if (session.expiresAt <= now) {
      if (options.revokeInvalidSession) await prisma.session.deleteMany({ where: { id: session.id } });
      clearSessionCookie(res);
      sendError(res, 401, ERROR_CODES.UNAUTHENTICATED, 'Not authenticated');
      return;
    }

    if (!isUserPermittedToSignIn(session.user)) {
      if (options.revokeInvalidSession) await prisma.session.deleteMany({ where: { id: session.id } });
      clearSessionCookie(res);
      sendError(res, 403, ERROR_CODES.ACCOUNT_UNAVAILABLE, 'This account is unavailable.');
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
    if (options.updateLastActiveAt) {
      prisma.user.update({ where: { id: session.user.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
    }
    next();
  });
}

/** Authentication boundary for normal player commands and reads. */
export const requireAuth = authenticatedRequest({ updateLastActiveAt: true, revokeInvalidSession: true, upgradeLegacySession: true });

/**
 * Authentication boundary for explicitly read-only projections. It verifies
 * the same session and account eligibility without touching activity state.
 */
export const requireReadOnlyAuth = authenticatedRequest({ updateLastActiveAt: false, revokeInvalidSession: false, upgradeLegacySession: false });

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

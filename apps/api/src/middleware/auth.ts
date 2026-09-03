import { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { SESSION_COOKIE } from '../lib/auth';

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

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }
  if (session.user.status === 'SUSPENDED' || session.user.status === 'BANNED') {
    res.status(403).json({ error: 'Account is suspended' });
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
}

export function requireRole(...roles: Array<'MODERATOR' | 'ADMIN'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role as 'MODERATOR' | 'ADMIN')) {
      res.status(403).json({ error: 'Insufficient permissions' });
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
    res.status(403).json({ error: 'Missing CSRF header' });
    return;
  }
  next();
}

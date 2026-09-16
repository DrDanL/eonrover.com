import { RequestHandler } from 'express';
import { getApiConfig } from '../config';
import { ERROR_CODES, sendError } from './error';

/**
 * The local administrator portal is intentionally unavailable in production
 * unless it has been enabled explicitly. This is evaluated server-side for
 * every `/api/admin` request and never reveals configuration values.
 */
export const requireAdminPortalRuntime: RequestHandler = (_req, res, next): void => {
  if (!getApiConfig().adminPortalEnabled) {
    sendError(res, 503, ERROR_CODES.ADMIN_PORTAL_UNAVAILABLE, 'Administrator portal is unavailable.');
    return;
  }
  next();
};

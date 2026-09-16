import { Router } from 'express';
import { requireReadOnlyAuth, requireRole } from '../middleware/auth';
import { requireAdminPortalRuntime } from '../middleware/adminPortal';
import { ERROR_CODES, sendError } from '../middleware/error';

const router = Router();

// This router is deliberately a small local-only read-only boundary. Do not
// reintroduce player-state sync, queue inspection, audit/security records, or
// mutable management operations without a separately reviewed API contract.
router.use(requireReadOnlyAuth, requireRole('ADMIN'), requireAdminPortalRuntime);

router.get('/status', (_req, res) => {
  res.json({ status: 'read-only' });
});

router.use((_req, res) => {
  sendError(
    res,
    503,
    ERROR_CODES.ADMIN_PORTAL_UNAVAILABLE,
    'Administrator management is not available in the read-only portal.',
  );
});

export default router;

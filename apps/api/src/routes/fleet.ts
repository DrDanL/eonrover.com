import { RequestHandler, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ERROR_CODES, sendError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

// The generic prototype mutates fleets without authoritative lifecycle
// safeguards. Keep its authenticated surface deliberately unavailable until
// the bounded deploy lifecycle replaces it.
const unavailable: RequestHandler = (_req, res) => {
  sendError(res, 503, ERROR_CODES.FLEET_MISSIONS_UNAVAILABLE, 'Fleet missions are temporarily unavailable.');
};

router.get('/', unavailable);
router.post('/', unavailable);
router.post('/:id/recall', unavailable);

export default router;

import { RequestHandler, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ERROR_CODES, sendError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

// Generic legacy reports expose raw payloads and have no canonical privacy
// contract. Keep their player surface unavailable; canonical Probe reports
// live behind the dedicated allowlisted read routes.
const unavailable: RequestHandler = (_req, res) => {
  sendError(res, 503, ERROR_CODES.REPORTS_UNAVAILABLE, 'Reports are temporarily unavailable.');
};

router.get('/combat', unavailable);
router.get('/espionage', unavailable);

export default router;

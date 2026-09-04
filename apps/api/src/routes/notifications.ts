import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError } from '../middleware/error';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ notifications });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification || notification.userId !== req.user!.id) {
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Notification not found');
    return;
  }
  await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  res.json({ message: 'Marked as read' });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ message: 'All notifications marked as read' });
}));

export default router;

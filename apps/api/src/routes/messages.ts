import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [inbox, sent] = await Promise.all([
    prisma.message.findMany({
      where: { recipientId: req.user!.id },
      include: { sender: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.message.findMany({
      where: { senderId: req.user!.id },
      include: { recipient: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  res.json({ inbox, sent });
});

const sendSchema = z.object({
  recipientUsername: z.string().min(1),
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
});

router.post('/', async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const recipient = await prisma.user.findUnique({ where: { username: parsed.data.recipientUsername } });
  if (!recipient) {
    res.status(404).json({ error: 'Recipient not found' });
    return;
  }
  const message = await prisma.message.create({
    data: {
      senderId: req.user!.id,
      recipientId: recipient.id,
      subject: parsed.data.subject,
      body: parsed.data.body,
    },
  });
  await prisma.notification.create({
    data: { userId: recipient.id, type: 'MESSAGE', message: `New message from ${req.user!.username}` },
  });
  res.status(201).json({ message });
});

router.post('/:id/read', async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message || message.recipientId !== req.user!.id) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  await prisma.message.update({ where: { id: message.id }, data: { readAt: new Date() } });
  res.json({ message: 'Marked as read' });
});

export default router;

import { Job } from 'bullmq';
import { prisma } from '../prisma';

interface ResearchJobData {
  queueItemId: string;
  userId: string;
}

export async function processResearchJob(job: Job<ResearchJobData>): Promise<void> {
  const item = await prisma.researchQueueItem.findUnique({ where: { id: job.data.queueItemId } });
  if (!item || item.status !== 'PENDING') return;

  await prisma.$transaction(async (tx) => {
    await tx.research.upsert({
      where: { userId_key: { userId: job.data.userId, key: item.researchKey } },
      update: { level: item.targetLevel },
      create: { userId: job.data.userId, key: item.researchKey, level: item.targetLevel },
    });
    await tx.researchQueueItem.update({ where: { id: item.id }, data: { status: 'COMPLETE' } });
  });

  await prisma.notification.create({
    data: {
      userId: job.data.userId,
      type: 'RESEARCH_COMPLETE',
      message: `${item.researchKey} research reached level ${item.targetLevel}.`,
    },
  });
}

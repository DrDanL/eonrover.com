import { Job } from 'bullmq';
import { completeResearch } from '@eonrover/shared';
import { prisma } from '../prisma';
import { researchQueue } from '../queues';

export interface ResearchJobData {
  queueItemId: string;
  /** Legacy payload field; intentionally ignored. */
  userId?: string;
}

export async function processResearchJob(job: Job<ResearchJobData>): Promise<void> {
  const result = await completeResearch(prisma, job.data.queueItemId);
  if (result === 'too-early') {
    const item = await prisma.researchQueueItem.findUnique({ where: { id: job.data.queueItemId } });
    if (item?.status === 'PENDING') {
      // The processor owns the currently-active job, so move that exact job
      // instead of adding a duplicate deterministic id that BullMQ would drop.
      await job.moveToDelayed(item.completesAt.getTime(), job.token);
    }
  }
}

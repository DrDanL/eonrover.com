import { Job } from 'bullmq';
import { completeShipyardBatch } from '@eonrover/shared';
import { prisma } from '../prisma';

export interface ShipyardJobData {
  queueItemId: string;
}

export async function processShipyardJob(job: Job<ShipyardJobData>): Promise<void> {
  // Only the persisted queue id is trusted from Redis.  The completion
  // service reloads ownership, quantity and due-time from PostgreSQL.
  const result = await completeShipyardBatch(prisma, job.data.queueItemId);
  if (result !== 'too-early') return;
  const item = await prisma.shipyardQueueItem.findUnique({
    where: { id: job.data.queueItemId }, select: { status: true, completesAt: true },
  });
  if (item?.status === 'PENDING') {
    await job.moveToDelayed(item.completesAt.getTime(), job.token);
  }
}

import { Job } from 'bullmq';
import { prisma } from '../prisma';
import { shipyardQueue } from '../queues';

interface ShipyardJobData {
  queueItemId: string;
  perUnitSeconds: number;
}

export async function processShipyardJob(job: Job<ShipyardJobData>): Promise<void> {
  const item = await prisma.shipyardQueueItem.findUnique({ where: { id: job.data.queueItemId } });
  if (!item || item.status !== 'PENDING') return;

  await prisma.$transaction(async (tx) => {
    if (item.itemType === 'ship') {
      await tx.ship.upsert({
        where: { planetId_key: { planetId: item.planetId, key: item.itemKey } },
        update: { count: { increment: 1 } },
        create: { planetId: item.planetId, key: item.itemKey, count: 1 },
      });
    } else {
      await tx.defence.upsert({
        where: { planetId_key: { planetId: item.planetId, key: item.itemKey } },
        update: { count: { increment: 1 } },
        create: { planetId: item.planetId, key: item.itemKey, count: 1 },
      });
    }
  });

  const remaining = item.remaining - 1;
  if (remaining > 0) {
    const completesAt = new Date(Date.now() + job.data.perUnitSeconds * 1000);
    const nextJob = await shipyardQueue.add(
      'complete-shipyard-unit',
      { queueItemId: item.id, perUnitSeconds: job.data.perUnitSeconds },
      { delay: job.data.perUnitSeconds * 1000, removeOnComplete: true, attempts: 3 },
    );
    await prisma.shipyardQueueItem.update({
      where: { id: item.id },
      data: { remaining, completesAt, jobId: nextJob.id },
    });
  } else {
    await prisma.shipyardQueueItem.update({ where: { id: item.id }, data: { remaining: 0, status: 'COMPLETE' } });
    const planet = await prisma.planet.findUnique({ where: { id: item.planetId } });
    if (planet) {
      await prisma.notification.create({
        data: {
          userId: planet.ownerId,
          type: 'SHIPYARD_COMPLETE',
          message: `${item.quantity}x ${item.itemKey} finished construction on ${planet.name}.`,
        },
      });
    }
  }
}

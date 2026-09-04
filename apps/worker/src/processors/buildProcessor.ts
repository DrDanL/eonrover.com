import { Job } from 'bullmq';
import { prisma } from '../prisma';

interface BuildJobData {
  queueItemId: string;
}

export async function processBuildJob(job: Job<BuildJobData>): Promise<void> {
  const item = await prisma.buildQueueItem.findUnique({ where: { id: job.data.queueItemId } });
  if (!item || item.status !== 'PENDING') return;

  await prisma.$transaction(async (tx) => {
    await tx.building.upsert({
      where: { planetId_key: { planetId: item.planetId, key: item.buildingKey } },
      update: { level: item.targetLevel },
      create: { planetId: item.planetId, key: item.buildingKey, level: item.targetLevel },
    });
    await tx.buildQueueItem.update({ where: { id: item.id }, data: { status: 'COMPLETE' } });
  });

  const planet = await prisma.planet.findUnique({ where: { id: item.planetId } });
  if (planet) {
    await prisma.notification.create({
      data: {
        userId: planet.ownerId,
        type: 'BUILDING_COMPLETE',
        message: `${item.buildingKey} reached level ${item.targetLevel} on ${planet.name}.`,
      },
    });
  }
}

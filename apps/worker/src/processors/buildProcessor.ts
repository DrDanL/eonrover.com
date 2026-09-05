import { DelayedError, Job } from 'bullmq';
import { completeBuildingConstruction } from '../buildingCompletion';

interface BuildJobData {
  queueItemId: string;
}

export async function processBuildJob(job: Job<BuildJobData>, token?: string): Promise<void> {
  const result = await completeBuildingConstruction(job.data.queueItemId, new Date());
  if (result.outcome === 'too-early') {
    await job.moveToDelayed(result.completesAt.getTime(), token);
    throw new DelayedError();
  }
}

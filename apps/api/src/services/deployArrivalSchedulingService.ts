import {
  DEPLOY_ARRIVAL_JOB_NAME,
  DeployArrivalJobData,
  DeployArrivalSchedulingOutcome,
  deployArrivalJobId,
  scheduleDeployArrivalWakeup as scheduleWakeup,
} from '@eonrover/shared';
import { deployArrivalQueue } from '../lib/redis';
import { prisma } from '../lib/prisma';

export { DEPLOY_ARRIVAL_JOB_NAME, deployArrivalJobId };
export type { DeployArrivalJobData, DeployArrivalSchedulingOutcome };

/**
 * API wrapper for shared canonical deploy wake-up scheduling. The same
 * database-only validation is used by worker reconciliation.
 */
export async function scheduleDeployArrivalWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<DeployArrivalSchedulingOutcome> {
  return scheduleWakeup(prisma, deployArrivalQueue, missionId, currentTime);
}

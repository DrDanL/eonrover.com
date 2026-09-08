import {
  COLONIZATION_ARRIVAL_JOB_NAME,
  ColonizationArrivalJobData,
  ColonizationArrivalSchedulingOutcome,
  colonizationArrivalJobId,
  scheduleColonizationArrivalWakeup as scheduleWakeup,
} from '@eonrover/shared';
import { colonizationArrivalQueue } from '../lib/redis';
import { prisma } from '../lib/prisma';

export { COLONIZATION_ARRIVAL_JOB_NAME, colonizationArrivalJobId };
export type { ColonizationArrivalJobData, ColonizationArrivalSchedulingOutcome };

/** Internal wrapper used only after a canonical launch commits. */
export async function scheduleColonizationArrivalWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<ColonizationArrivalSchedulingOutcome> {
  return scheduleWakeup(prisma, colonizationArrivalQueue, missionId, currentTime);
}

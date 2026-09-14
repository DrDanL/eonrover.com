import {
  CORVETTE_STRIKE_ARRIVAL_JOB_NAME,
  CORVETTE_STRIKE_RETURN_JOB_NAME,
  CorvetteStrikeArrivalJobData,
  CorvetteStrikeSchedulingOutcome,
  corvetteStrikeArrivalJobId,
  corvetteStrikeReturnJobId,
  scheduleCorvetteStrikeArrivalWakeup as scheduleArrival,
  scheduleCorvetteStrikeReturnWakeup as scheduleReturn,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { corvetteStrikeArrivalQueue } from '../lib/redis';

export { CORVETTE_STRIKE_ARRIVAL_JOB_NAME, CORVETTE_STRIKE_RETURN_JOB_NAME, corvetteStrikeArrivalJobId, corvetteStrikeReturnJobId };
export type { CorvetteStrikeArrivalJobData, CorvetteStrikeSchedulingOutcome };
export const scheduleCorvetteStrikeArrivalWakeup = (missionId: string, currentTime = new Date()) => scheduleArrival(prisma, corvetteStrikeArrivalQueue, missionId, currentTime);
export const scheduleCorvetteStrikeReturnWakeup = (missionId: string, currentTime = new Date()) => scheduleReturn(prisma, corvetteStrikeArrivalQueue, missionId, currentTime);

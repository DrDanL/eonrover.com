import {
  FRIGATE_STRIKE_ARRIVAL_JOB_NAME,
  FRIGATE_STRIKE_RETURN_JOB_NAME,
  FrigateStrikeArrivalJobData,
  FrigateStrikeSchedulingOutcome,
  frigateStrikeArrivalJobId,
  frigateStrikeReturnJobId,
  scheduleFrigateStrikeArrivalWakeup as scheduleArrival,
  scheduleFrigateStrikeReturnWakeup as scheduleReturn,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { frigateStrikeArrivalQueue } from '../lib/redis';
export { FRIGATE_STRIKE_ARRIVAL_JOB_NAME, FRIGATE_STRIKE_RETURN_JOB_NAME, frigateStrikeArrivalJobId, frigateStrikeReturnJobId };
export type { FrigateStrikeArrivalJobData, FrigateStrikeSchedulingOutcome };
export const scheduleFrigateStrikeArrivalWakeup = (missionId: string, now = new Date()) => scheduleArrival(prisma, frigateStrikeArrivalQueue, missionId, now);
export const scheduleFrigateStrikeReturnWakeup = (missionId: string, now = new Date()) => scheduleReturn(prisma, frigateStrikeArrivalQueue, missionId, now);

import {
  TRANSPORT_ARRIVAL_JOB_NAME,
  TRANSPORT_RETURN_JOB_NAME,
  TransportArrivalJobData,
  TransportSchedulingOutcome,
  transportArrivalJobId,
  transportReturnJobId,
  scheduleTransportArrivalWakeup as scheduleArrival,
  scheduleTransportReturnWakeup as scheduleReturn,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { transportArrivalQueue } from '../lib/redis';

export {
  TRANSPORT_ARRIVAL_JOB_NAME,
  TRANSPORT_RETURN_JOB_NAME,
  transportArrivalJobId,
  transportReturnJobId,
};
export type { TransportArrivalJobData, TransportSchedulingOutcome };

/** Best-effort wrapper for a committed canonical outbound transport mission. */
export function scheduleTransportArrivalWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<TransportSchedulingOutcome> {
  return scheduleArrival(prisma, transportArrivalQueue, missionId, currentTime);
}

/** Best-effort wrapper for a committed canonical returning transport mission. */
export function scheduleTransportReturnWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<TransportSchedulingOutcome> {
  return scheduleReturn(prisma, transportArrivalQueue, missionId, currentTime);
}

import {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  EspionageProbeArrivalJobData,
  EspionageProbeSchedulingOutcome,
  espionageProbeArrivalJobId,
  espionageProbeReturnJobId,
  scheduleEspionageProbeArrivalWakeup as scheduleArrival,
  scheduleEspionageProbeReturnWakeup as scheduleReturn,
} from '@eonrover/shared';
import { prisma } from '../lib/prisma';
import { espionageProbeArrivalQueue } from '../lib/redis';

export {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  espionageProbeArrivalJobId,
  espionageProbeReturnJobId,
};
export type { EspionageProbeArrivalJobData, EspionageProbeSchedulingOutcome };

/** Best-effort wake-up for a committed canonical outbound Probe mission. */
export function scheduleEspionageProbeArrivalWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<EspionageProbeSchedulingOutcome> {
  return scheduleArrival(prisma, espionageProbeArrivalQueue, missionId, currentTime);
}

/** Best-effort wake-up for a committed canonical returning Probe mission. */
export function scheduleEspionageProbeReturnWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<EspionageProbeSchedulingOutcome> {
  return scheduleReturn(prisma, espionageProbeArrivalQueue, missionId, currentTime);
}

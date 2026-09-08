import { Job } from 'bullmq';
import {
  completeOwnedPlanetDeployArrival,
  DEPLOY_ARRIVAL_JOB_NAME,
  DeployArrivalCompletionOutcome,
} from '@eonrover/shared';
import { prisma } from '../prisma';

export { DEPLOY_ARRIVAL_JOB_NAME };

export interface DeployArrivalJobData {
  missionId?: unknown;
}

/**
 * Processes only the dedicated deploy-arrival wake-up. The mission id is the
 * sole accepted payload value; all game state is reloaded by the shared
 * PostgreSQL-authoritative completion service.
 */
export async function processDeployArrivalJob(
  job: Job<DeployArrivalJobData>,
): Promise<DeployArrivalCompletionOutcome | 'ignored'> {
  if (job.name !== DEPLOY_ARRIVAL_JOB_NAME || typeof job.data?.missionId !== 'string' || !job.data.missionId) {
    return 'ignored';
  }

  const outcome = await completeOwnedPlanetDeployArrival(prisma, job.data.missionId);
  if (outcome !== 'early') return outcome;

  // Never accept a completion time from Redis. The same active deterministic
  // job is moved back using the persisted canonical arrival timestamp.
  const mission = await prisma.fleetMission.findUnique({
    where: { id: job.data.missionId },
    select: { status: true, arrivesAt: true },
  });
  if (mission?.status === 'OUTBOUND') {
    await job.moveToDelayed(mission.arrivesAt.getTime(), job.token);
  }
  return outcome;
}

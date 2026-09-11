import { Job } from 'bullmq';
import {
  COLONIZATION_ARRIVAL_JOB_NAME,
  ColonizationCompletionOutcome,
  completeCanonicalColonization,
} from '@eonrover/shared';
import { prisma } from '../prisma';

export { COLONIZATION_ARRIVAL_JOB_NAME };

export interface ColonizationArrivalJobData {
  missionId?: unknown;
}

/**
 * Consumes only the canonical colonisation wake-up. Redis supplies a mission
 * identifier, never game state: the shared completion transaction reloads all
 * authoritative snapshots and ownership from PostgreSQL.
 */
export async function processColonizationArrivalJob(
  job: Job<ColonizationArrivalJobData>,
): Promise<ColonizationCompletionOutcome | 'ignored'> {
  if (job.name !== COLONIZATION_ARRIVAL_JOB_NAME || typeof job.data?.missionId !== 'string' || !job.data.missionId) {
    return 'ignored';
  }

  const outcome = await completeCanonicalColonization(prisma, job.data.missionId);
  if (outcome !== 'early') return outcome;

  // Redis cannot supply the authoritative deadline. Re-read the persisted
  // canonical timing and move this same deterministic job back to it.
  const mission = await prisma.fleetMission.findUnique({
    where: { id: job.data.missionId },
    select: { status: true, arrivesAt: true },
  });
  if (mission?.status === 'OUTBOUND') {
    await job.moveToDelayed(mission.arrivesAt.getTime(), job.token);
  }
  return outcome;
}

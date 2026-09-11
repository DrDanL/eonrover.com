import { Job } from 'bullmq';
import {
  ESPIONAGE_PROBE_ARRIVAL_JOB_NAME,
  ESPIONAGE_PROBE_RETURN_JOB_NAME,
  EspionageProbeCompletionOutcome,
  EspionageProbeArrivalJobData,
  espionageProbeArrivalJobId,
  espionageProbeReturnJobId,
  scheduleEspionageProbeReturnWakeup,
  settleCanonicalEspionageProbe,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { espionageProbeArrivalQueue } from '../queues';

export { ESPIONAGE_PROBE_ARRIVAL_JOB_NAME, ESPIONAGE_PROBE_RETURN_JOB_NAME };
export type { EspionageProbeArrivalJobData };

type PersistedWakeup = {
  phase: 'OUTBOUND' | 'RETURNING';
  dueAt: Date;
};

async function persistedWakeup(missionId: string): Promise<PersistedWakeup | null> {
  const mission = await prisma.fleetMission.findUnique({
    where: { id: missionId },
    select: {
      missionType: true,
      status: true,
      espionageProbePhase: true,
      arrivesAt: true,
      returnsAt: true,
    },
  });
  if (!mission || mission.missionType !== 'ESPIONAGE') return null;
  if (mission.espionageProbePhase === 'OUTBOUND' && mission.status === 'OUTBOUND'
    && Number.isFinite(mission.arrivesAt.getTime())) {
    return { phase: 'OUTBOUND', dueAt: mission.arrivesAt };
  }
  if (mission.espionageProbePhase === 'RETURNING' && mission.status === 'RETURNING'
    && mission.returnsAt && Number.isFinite(mission.returnsAt.getTime())) {
    return { phase: 'RETURNING', dueAt: mission.returnsAt };
  }
  return null;
}

/**
 * Redis supplies only a mission id. Canonical phase and timing are always
 * reloaded from PostgreSQL; job names and ids are queue-hygiene checks only.
 */
export async function processEspionageProbeArrivalJob(
  job: Job<EspionageProbeArrivalJobData>,
): Promise<EspionageProbeCompletionOutcome | 'ignored'> {
  if ((job.name !== ESPIONAGE_PROBE_ARRIVAL_JOB_NAME && job.name !== ESPIONAGE_PROBE_RETURN_JOB_NAME)
    || typeof job.data?.missionId !== 'string' || !job.data.missionId) return 'ignored';

  const wakeup = await persistedWakeup(job.data.missionId);
  if (!wakeup) return 'noop';
  const expectedJobId = wakeup.phase === 'OUTBOUND'
    ? espionageProbeArrivalJobId(job.data.missionId)
    : espionageProbeReturnJobId(job.data.missionId);
  if (job.id && job.id !== expectedJobId) return 'ignored';

  const outcome = await settleCanonicalEspionageProbe(prisma, job.data.missionId, new Date(), {
    scheduleReturnWakeup: (missionId, currentTime) =>
      scheduleEspionageProbeReturnWakeup(prisma, espionageProbeArrivalQueue, missionId, currentTime),
  });
  if (outcome !== 'early') return outcome;

  // Only the authoritative completion core can establish that an early row
  // is canonical. Re-read its persisted phase and deadline before moving the
  // same deterministic job; malformed rows always returned `noop` above.
  const canonicalWakeup = await persistedWakeup(job.data.missionId);
  if (!canonicalWakeup || canonicalWakeup.dueAt.getTime() <= Date.now()) return 'noop';
  await job.moveToDelayed(canonicalWakeup.dueAt.getTime(), job.token);
  return 'early';
}

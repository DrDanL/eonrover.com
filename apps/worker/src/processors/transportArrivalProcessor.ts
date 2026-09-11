import { Job } from 'bullmq';
import {
  scheduleTransportReturnWakeup,
  settleCanonicalTransport,
  TRANSPORT_ARRIVAL_JOB_NAME,
  TRANSPORT_RETURN_JOB_NAME,
  TransportArrivalJobData,
  TransportCompletionOutcome,
  transportArrivalJobId,
  transportReturnJobId,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { transportArrivalQueue } from '../queues';

export { TRANSPORT_ARRIVAL_JOB_NAME, TRANSPORT_RETURN_JOB_NAME };
export type { TransportArrivalJobData };

type Wakeup = 'arrival' | 'return';

async function persistedDueTime(missionId: string, wakeup: Wakeup): Promise<Date | null> {
  const mission = await prisma.fleetMission.findUnique({
    where: { id: missionId },
    select: { missionType: true, status: true, transportPhase: true, arrivesAt: true, returnsAt: true },
  });
  if (!mission || mission.missionType !== 'TRANSPORT') return null;
  const expectedPhase = wakeup === 'arrival' ? 'OUTBOUND' : 'RETURNING';
  const expectedStatus = wakeup === 'arrival' ? 'OUTBOUND' : 'RETURNING';
  const dueAt = wakeup === 'arrival' ? mission.arrivesAt : mission.returnsAt;
  return mission.transportPhase === expectedPhase && mission.status === expectedStatus
    && dueAt && Number.isFinite(dueAt.getTime()) ? dueAt : null;
}

/** Redis provides only a mission id; canonical state is always reloaded from PostgreSQL. */
export async function processTransportArrivalJob(
  job: Job<TransportArrivalJobData>,
): Promise<TransportCompletionOutcome | 'ignored'> {
  const wakeup: Wakeup | null = job.name === TRANSPORT_ARRIVAL_JOB_NAME
    ? 'arrival'
    : job.name === TRANSPORT_RETURN_JOB_NAME ? 'return' : null;
  if (!wakeup || typeof job.data?.missionId !== 'string' || !job.data.missionId) return 'ignored';
  const expectedJobId = wakeup === 'arrival'
    ? transportArrivalJobId(job.data.missionId)
    : transportReturnJobId(job.data.missionId);
  // Job identity is queue hygiene only. It cannot establish game state, but a
  // malformed queue record must not wake the canonical lifecycle.
  if (job.id && job.id !== expectedJobId) return 'ignored';

  const dueAt = await persistedDueTime(job.data.missionId, wakeup);
  if (!dueAt) return 'noop';
  if (dueAt.getTime() > Date.now()) {
    await job.moveToDelayed(dueAt.getTime(), job.token);
    return 'early';
  }

  return settleCanonicalTransport(prisma, job.data.missionId, new Date(), {
    scheduleReturnWakeup: (missionId, currentTime) =>
      scheduleTransportReturnWakeup(prisma, transportArrivalQueue, missionId, currentTime),
  });
}

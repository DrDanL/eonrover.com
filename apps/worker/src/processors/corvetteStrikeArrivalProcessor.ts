import { Job } from 'bullmq';
import {
  CORVETTE_STRIKE_ARRIVAL_JOB_NAME,
  CORVETTE_STRIKE_RETURN_JOB_NAME,
  CorvetteStrikeArrivalJobData,
  CorvetteStrikeCompletionOutcome,
  corvetteStrikeArrivalJobId,
  corvetteStrikeReturnJobId,
  scheduleCorvetteStrikeReturnWakeup,
  settleCanonicalCorvetteStrike,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { corvetteStrikeArrivalQueue } from '../queues';

export { CORVETTE_STRIKE_ARRIVAL_JOB_NAME, CORVETTE_STRIKE_RETURN_JOB_NAME };
export type { CorvetteStrikeArrivalJobData };
type Wakeup = { phase: 'OUTBOUND' | 'RETURNING'; dueAt: Date };
async function wakeup(missionId: string): Promise<Wakeup | null> {
  const mission = await prisma.fleetMission.findUnique({ where: { id: missionId }, select: { missionType: true, status: true, corvetteStrikePhase: true, arrivesAt: true, returnsAt: true } });
  if (!mission || mission.missionType !== 'ATTACK') return null;
  if (mission.corvetteStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND' && Number.isFinite(mission.arrivesAt.getTime())) return { phase: 'OUTBOUND', dueAt: mission.arrivesAt };
  if (mission.corvetteStrikePhase === 'RETURNING' && mission.status === 'RETURNING' && mission.returnsAt && Number.isFinite(mission.returnsAt.getTime())) return { phase: 'RETURNING', dueAt: mission.returnsAt };
  return null;
}
/** Job payloads supply only the opaque mission id; PostgreSQL supplies every lifecycle fact. */
export async function processCorvetteStrikeArrivalJob(job: Job<CorvetteStrikeArrivalJobData>): Promise<CorvetteStrikeCompletionOutcome | 'ignored' | 'noop'> {
  if ((job.name !== CORVETTE_STRIKE_ARRIVAL_JOB_NAME && job.name !== CORVETTE_STRIKE_RETURN_JOB_NAME) || typeof job.data?.missionId !== 'string' || !job.data.missionId) return 'ignored';
  const persisted = await wakeup(job.data.missionId);
  if (!persisted) return 'noop';
  const expected = persisted.phase === 'OUTBOUND' ? corvetteStrikeArrivalJobId(job.data.missionId) : corvetteStrikeReturnJobId(job.data.missionId);
  if (job.id && job.id !== expected) return 'ignored';
  const outcome = await settleCanonicalCorvetteStrike(prisma, job.data.missionId, new Date(), {
    scheduleReturnWakeup: (missionId, now) => scheduleCorvetteStrikeReturnWakeup(prisma, corvetteStrikeArrivalQueue, missionId, now),
  });
  if (outcome !== 'early') return outcome;
  const canonical = await wakeup(job.data.missionId);
  if (!canonical || canonical.dueAt.getTime() <= Date.now()) return 'noop';
  await job.moveToDelayed(canonical.dueAt.getTime(), job.token);
  return 'early';
}

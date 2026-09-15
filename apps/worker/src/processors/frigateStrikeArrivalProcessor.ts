import { Job } from 'bullmq';
import {
  FRIGATE_STRIKE_ARRIVAL_JOB_NAME,
  FRIGATE_STRIKE_RETURN_JOB_NAME,
  FrigateStrikeArrivalJobData,
  FrigateStrikeCompletionOutcome,
  frigateStrikeArrivalJobId,
  frigateStrikeReturnJobId,
  scheduleFrigateStrikeReturnWakeup,
  settleCanonicalFrigateStrike,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { frigateStrikeArrivalQueue } from '../queues';

export { FRIGATE_STRIKE_ARRIVAL_JOB_NAME, FRIGATE_STRIKE_RETURN_JOB_NAME };
export type { FrigateStrikeArrivalJobData };

type Wakeup = { phase: 'OUTBOUND' | 'RETURNING'; dueAt: Date };
async function wakeup(missionId: string): Promise<Wakeup | null> {
  const mission = await prisma.fleetMission.findUnique({ where: { id: missionId }, select: { missionType: true, status: true, frigateStrikePhase: true, arrivesAt: true, returnsAt: true } });
  if (!mission || mission.missionType !== 'ATTACK') return null;
  if (mission.frigateStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND' && Number.isFinite(mission.arrivesAt.getTime())) return { phase: 'OUTBOUND', dueAt: mission.arrivesAt };
  if (mission.frigateStrikePhase === 'RETURNING' && mission.status === 'RETURNING' && mission.returnsAt && Number.isFinite(mission.returnsAt.getTime())) return { phase: 'RETURNING', dueAt: mission.returnsAt };
  return null;
}

/** BullMQ carries only missionId; every phase, timestamp, force and result comes from PostgreSQL. */
export async function processFrigateStrikeArrivalJob(job: Job<FrigateStrikeArrivalJobData>): Promise<FrigateStrikeCompletionOutcome | 'ignored' | 'noop'> {
  if ((job.name !== FRIGATE_STRIKE_ARRIVAL_JOB_NAME && job.name !== FRIGATE_STRIKE_RETURN_JOB_NAME) || typeof job.data?.missionId !== 'string' || !job.data.missionId) return 'ignored';
  const persisted = await wakeup(job.data.missionId);
  if (!persisted) return 'noop';
  const expected = persisted.phase === 'OUTBOUND' ? frigateStrikeArrivalJobId(job.data.missionId) : frigateStrikeReturnJobId(job.data.missionId);
  if (job.id && job.id !== expected) return 'ignored';
  const outcome = await settleCanonicalFrigateStrike(prisma, job.data.missionId, new Date(), {
    scheduleReturnWakeup: (missionId, now) => scheduleFrigateStrikeReturnWakeup(prisma, frigateStrikeArrivalQueue, missionId, now),
  });
  // `unavailable` means the authoritative transaction exhausted its bounded
  // retry budget. Let BullMQ retry the same deterministic wake-up rather than
  // acknowledging it as settled.
  if (outcome === 'unavailable') throw new Error('Canonical Frigate strike settlement is temporarily unavailable.');
  if (outcome !== 'early') return outcome;
  const canonical = await wakeup(job.data.missionId);
  if (!canonical || canonical.dueAt.getTime() <= Date.now()) return 'noop';
  await job.moveToDelayed(canonical.dueAt.getTime(), job.token);
  return 'early';
}

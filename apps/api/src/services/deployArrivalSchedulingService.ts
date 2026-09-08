import { canonicalDeployShips } from '@eonrover/shared';
import { deployArrivalQueue } from '../lib/redis';
import { prisma } from '../lib/prisma';

export const DEPLOY_ARRIVAL_JOB_NAME = 'complete-deploy-arrival';

export interface DeployArrivalJobData {
  missionId: string;
}

export type DeployArrivalSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';

const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);

export function deployArrivalJobId(missionId: string): string {
  return `fleet-deploy-arrival-${missionId}`;
}

function canonicalManifest(value: unknown): boolean {
  try {
    canonicalDeployShips(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort producer for the dedicated deploy-arrival worker. It only reads
 * committed PostgreSQL state, never updates it, and intentionally leaves
 * retained completed/failed queue jobs untouched: they are terminal records,
 * not runnable wake-ups. Repair and cleanup are future reconciliation work.
 */
export async function scheduleDeployArrivalWakeup(
  missionId: string,
  currentTime = new Date(),
): Promise<DeployArrivalSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';

  const mission = await prisma.fleetMission.findUnique({
    where: { id: missionId },
    include: {
      origin: { select: { id: true, ownerId: true } },
      target: { select: { id: true } },
      deployOrigin: { select: { id: true } },
      deployDestination: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    },
  });
  if (
    !mission
    || mission.missionType !== 'DEPLOY'
    || mission.status !== 'OUTBOUND'
    || !mission.deployOrigin
    || !mission.deployDestination
    || mission.deployOriginId !== mission.origin.id
    || mission.deployDestinationId !== mission.deployDestination.id
    || mission.originId !== mission.origin.id
    || mission.targetId !== mission.deployDestination.id
    || mission.target?.id !== mission.deployDestination.id
    || mission.targetGalaxy !== mission.deployDestination.galaxy
    || mission.targetSystem !== mission.deployDestination.system
    || mission.targetSlot !== mission.deployDestination.slot
    || mission.origin.ownerId !== mission.deployDestination.ownerId
    || !canonicalManifest(mission.deployShips)
    || !Number.isInteger(mission.deployFuelHeliox ?? NaN)
    || (mission.deployFuelHeliox ?? -1) < 0
    || !Number.isInteger(mission.deployDurationSeconds ?? NaN)
    || (mission.deployDurationSeconds ?? 0) <= 0
    || !Number.isFinite(mission.arrivesAt.getTime())
  ) return 'ineligible';

  const jobId = deployArrivalJobId(mission.id);
  try {
    const existing = await deployArrivalQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_JOB_STATES.has(state)) return 'existing';
      // Do not remove terminal or unknown retained jobs here. They cannot be
      // treated as a runnable wake-up, and repair belongs to a later stage.
      return 'retained-terminal';
    }
    await deployArrivalQueue.add(
      DEPLOY_ARRIVAL_JOB_NAME,
      { missionId: mission.id } satisfies DeployArrivalJobData,
      {
        jobId,
        delay: Math.max(0, mission.arrivesAt.getTime() - currentTime.getTime()),
        removeOnComplete: true,
        attempts: 3,
      },
    );
    return 'scheduled';
  } catch {
    // Redis is only a wake-up channel. A failed attempt leaves PostgreSQL
    // untouched and reports a bounded observable outcome to the caller.
    return 'failed';
  }
}

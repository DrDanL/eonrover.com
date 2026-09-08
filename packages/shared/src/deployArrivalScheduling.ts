import { canonicalDeployShips } from './deployMission';

export const DEPLOY_ARRIVAL_JOB_NAME = 'complete-deploy-arrival';

export interface DeployArrivalJobData {
  missionId: string;
}

export type DeployArrivalSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';

export interface DeployArrivalSchedulingDatabase {
  fleetMission: any;
}

export interface DeployArrivalSchedulingQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined>;
  add(name: string, data: DeployArrivalJobData, options: {
    jobId: string;
    delay: number;
    removeOnComplete: boolean;
    attempts: number;
  }): Promise<unknown>;
}

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
 * Best-effort deploy-arrival wake-up scheduling from committed canonical
 * PostgreSQL state. The database never changes here; Redis is only a
 * deterministic wake-up channel and retained terminal jobs are untouched.
 */
export async function scheduleDeployArrivalWakeup(
  database: DeployArrivalSchedulingDatabase,
  queue: DeployArrivalSchedulingQueue,
  missionId: string,
  currentTime = new Date(),
): Promise<DeployArrivalSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';

  const mission = await database.fleetMission.findUnique({
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
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_JOB_STATES.has(state)) return 'existing';
      return 'retained-terminal';
    }
    await queue.add(
      DEPLOY_ARRIVAL_JOB_NAME,
      { missionId: mission.id },
      {
        jobId,
        delay: Math.max(0, mission.arrivesAt.getTime() - currentTime.getTime()),
        removeOnComplete: true,
        attempts: 3,
      },
    );
    return 'scheduled';
  } catch {
    return 'failed';
  }
}

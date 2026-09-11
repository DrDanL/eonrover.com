export const ESPIONAGE_PROBE_ARRIVAL_JOB_NAME = 'complete-espionage-probe-arrival';
export const ESPIONAGE_PROBE_RETURN_JOB_NAME = 'complete-espionage-probe-return';

export interface EspionageProbeArrivalJobData {
  missionId: string;
}
export type EspionageProbeSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';

export interface EspionageProbeSchedulingDatabase {
  fleetMission: any;
}

export interface EspionageProbeSchedulingQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined>;
  add(name: string, data: EspionageProbeArrivalJobData, options: {
    jobId: string;
    delay: number;
    removeOnComplete: boolean;
    attempts: number;
  }): Promise<unknown>;
}

type ProbeWakeupKind = 'arrival' | 'return';

const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);

export function espionageProbeArrivalJobId(missionId: string): string {
  return `espionage-probe-arrival-${missionId}`;
}

export function espionageProbeReturnJobId(missionId: string): string {
  return `espionage-probe-return-${missionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function canonicalProbeManifest(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.probe === 1;
}

function canonicalProbeSnapshots(mission: any): boolean {
  return canonicalProbeManifest(mission.espionageProbeShips)
    && nonNegativeSafeInteger(mission.espionageOutboundFuelHeliox)
    && nonNegativeSafeInteger(mission.espionageReturnFuelHeliox)
    && Number.isSafeInteger(mission.espionageOutboundDurationSeconds)
    && mission.espionageOutboundDurationSeconds > 0
    && Number.isSafeInteger(mission.espionageReturnDurationSeconds)
    && mission.espionageReturnDurationSeconds > 0
    && Number.isFinite(mission.departedAt?.getTime?.())
    && Number.isFinite(mission.arrivesAt?.getTime?.())
    && Number.isFinite(mission.returnsAt?.getTime?.())
    && mission.arrivesAt.getTime() - mission.departedAt.getTime() === mission.espionageOutboundDurationSeconds * 1_000
    && mission.returnsAt.getTime() - mission.arrivesAt.getTime() === mission.espionageReturnDurationSeconds * 1_000;
}

function validMission(mission: any, kind: ProbeWakeupKind): boolean {
  if (!mission
    || mission.missionType !== 'ESPIONAGE'
    || !mission.espionageOriginPlanet
    || !mission.espionageTargetPlanet
    || !mission.espionageOriginAccount
    || !mission.espionageTargetAccount
    || mission.espionageOriginPlanetId !== mission.espionageOriginPlanet.id
    || mission.espionageTargetPlanetId !== mission.espionageTargetPlanet.id
    || mission.espionageOriginAccountId !== mission.espionageOriginAccount.id
    || mission.espionageTargetAccountId !== mission.espionageTargetAccount.id
    || mission.espionageOriginPlanet.ownerId !== mission.espionageOriginAccount.id
    || mission.espionageTargetPlanet.ownerId !== mission.espionageTargetAccount.id
    || mission.espionageOriginAccount.id === mission.espionageTargetAccount.id
    || mission.originId !== mission.espionageOriginPlanet.id
    || mission.targetId !== mission.espionageTargetPlanet.id
    || mission.targetGalaxy !== mission.espionageTargetPlanet.galaxy
    || mission.targetSystem !== mission.espionageTargetPlanet.system
    || mission.targetSlot !== mission.espionageTargetPlanet.slot
    || mission.speedPercent !== 100
    || !canonicalProbeSnapshots(mission)) return false;
  if (kind === 'arrival') {
    return mission.espionageProbePhase === 'OUTBOUND' && mission.status === 'OUTBOUND';
  }
  return mission.espionageProbePhase === 'RETURNING' && mission.status === 'RETURNING';
}

async function scheduleProbeWakeup(
  database: EspionageProbeSchedulingDatabase,
  queue: EspionageProbeSchedulingQueue,
  missionId: string,
  kind: ProbeWakeupKind,
  currentTime = new Date(),
): Promise<EspionageProbeSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';
  const mission = await database.fleetMission.findUnique({
    where: { id: missionId },
    include: {
      espionageOriginPlanet: { select: { id: true, ownerId: true } },
      espionageTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
      espionageOriginAccount: { select: { id: true } },
      espionageTargetAccount: { select: { id: true } },
    },
  });
  if (!validMission(mission, kind)) return 'ineligible';

  const jobId = kind === 'arrival' ? espionageProbeArrivalJobId(mission.id) : espionageProbeReturnJobId(mission.id);
  const jobName = kind === 'arrival' ? ESPIONAGE_PROBE_ARRIVAL_JOB_NAME : ESPIONAGE_PROBE_RETURN_JOB_NAME;
  const dueAt = kind === 'arrival' ? mission.arrivesAt : mission.returnsAt;
  try {
    const existing = await queue.getJob(jobId);
    if (existing) return LIVE_JOB_STATES.has(await existing.getState()) ? 'existing' : 'retained-terminal';
    await queue.add(jobName, { missionId: mission.id }, {
      jobId,
      delay: Math.max(0, dueAt.getTime() - currentTime.getTime()),
      removeOnComplete: true,
      attempts: 3,
    });
    return 'scheduled';
  } catch {
    return 'failed';
  }
}

/** Schedules only a committed canonical outbound Probe arrival wake-up. */
export function scheduleEspionageProbeArrivalWakeup(
  database: EspionageProbeSchedulingDatabase,
  queue: EspionageProbeSchedulingQueue,
  missionId: string,
  currentTime = new Date(),
): Promise<EspionageProbeSchedulingOutcome> {
  return scheduleProbeWakeup(database, queue, missionId, 'arrival', currentTime);
}

/** Schedules only a committed canonical returning Probe wake-up. */
export function scheduleEspionageProbeReturnWakeup(
  database: EspionageProbeSchedulingDatabase,
  queue: EspionageProbeSchedulingQueue,
  missionId: string,
  currentTime = new Date(),
): Promise<EspionageProbeSchedulingOutcome> {
  return scheduleProbeWakeup(database, queue, missionId, 'return', currentTime);
}

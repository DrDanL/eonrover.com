import { COLONY_STARTER_STATE, PLANET_TYPES } from './constants';

export const COLONIZATION_ARRIVAL_JOB_NAME = 'complete-colony-arrival';

export interface ColonizationArrivalJobData {
  missionId: string;
}

export type ColonizationArrivalSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';

export interface ColonizationArrivalSchedulingDatabase {
  fleetMission: any;
}

export interface ColonizationArrivalSchedulingQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined>;
  add(name: string, data: ColonizationArrivalJobData, options: {
    jobId: string;
    delay: number;
    removeOnComplete: boolean;
    attempts: number;
  }): Promise<unknown>;
}

const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);

export function colonizationArrivalJobId(missionId: string): string {
  return `colony-arrival-${missionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function canonicalManifest(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.colonyShip === 1;
}

function canonicalCharacteristics(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['planetType', 'temperature', 'solarIndex', 'fieldCapacity'])) return false;
  if (typeof value.planetType !== 'string' || !(value.planetType in PLANET_TYPES)
    || typeof value.temperature !== 'number' || typeof value.solarIndex !== 'number') return false;
  const profile = PLANET_TYPES[value.planetType as keyof typeof PLANET_TYPES];
  return Number.isInteger(value.temperature)
    && value.temperature >= profile.temperatureRange[0]
    && value.temperature <= profile.temperatureRange[1]
    && Number.isFinite(value.solarIndex)
    && value.solarIndex >= profile.solarIndexRange[0]
    && value.solarIndex <= profile.solarIndexRange[1]
    && value.fieldCapacity === COLONY_STARTER_STATE.fieldCapacity;
}

function canonicalStarterState(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['fieldCapacity', 'resources', 'buildings'])
    || value.fieldCapacity !== COLONY_STARTER_STATE.fieldCapacity
    || !isRecord(value.resources) || !hasOnlyKeys(value.resources, ['alloy', 'heliox', 'aether'])
    || !isRecord(value.buildings) || !hasOnlyKeys(value.buildings, Object.keys(COLONY_STARTER_STATE.buildings))) return false;
  const resources = value.resources;
  const buildings = value.buildings;
  return ['alloy', 'heliox', 'aether'].every((key) => typeof resources[key] === 'number'
    && Number.isFinite(resources[key]) && resources[key] >= 0)
    && ['solarArray', 'alloyMine', 'helioxExtractor'].every((key) => typeof buildings[key] === 'number'
      && Number.isSafeInteger(buildings[key]) && buildings[key] >= 0);
}

function validTargetCoordinate(mission: any): boolean {
  return Number.isSafeInteger(mission.colonizationTargetGalaxy) && mission.colonizationTargetGalaxy > 0
    && Number.isSafeInteger(mission.colonizationTargetSystem) && mission.colonizationTargetSystem > 0
    && Number.isSafeInteger(mission.colonizationTargetSlot)
    && mission.colonizationTargetSlot >= 1 && mission.colonizationTargetSlot <= 12;
}

/**
 * Best-effort canonical colonisation wake-up scheduling from committed
 * PostgreSQL state. It deliberately reads no legacy mission JSON and never
 * mutates PostgreSQL: Redis is solely the deterministic wake-up channel.
 */
export async function scheduleColonizationArrivalWakeup(
  database: ColonizationArrivalSchedulingDatabase,
  queue: ColonizationArrivalSchedulingQueue,
  missionId: string,
  currentTime = new Date(),
): Promise<ColonizationArrivalSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';

  const mission = await database.fleetMission.findUnique({
    where: { id: missionId },
    include: {
      origin: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
      colonizationAccount: { select: { id: true } },
    },
  });
  if (
    !mission
    || mission.missionType !== 'COLONIZE'
    || mission.status !== 'OUTBOUND'
    || !mission.origin
    || !mission.colonizationAccount
    || mission.colonizationAccountId !== mission.origin.ownerId
    || mission.colonizationAccount.id !== mission.origin.ownerId
    || !validTargetCoordinate(mission)
    || mission.originId !== mission.origin.id
    || mission.targetId !== null
    || mission.targetGalaxy !== mission.colonizationTargetGalaxy
    || mission.targetSystem !== mission.colonizationTargetSystem
    || mission.targetSlot !== mission.colonizationTargetSlot
    || mission.colonizationTargetGalaxy !== mission.origin.galaxy
    || mission.colonizationTargetSystem !== mission.origin.system
    || mission.colonizationTargetSlot === mission.origin.slot
    || mission.speedPercent !== 100
    || mission.createdPlanetId !== null
    || !canonicalManifest(mission.colonizationShips)
    || !canonicalCharacteristics(mission.colonizationCharacteristics)
    || !canonicalStarterState(mission.colonizationStarterState)
    || !Number.isInteger(mission.colonizationFuelHeliox ?? NaN)
    || (mission.colonizationFuelHeliox ?? -1) < 0
    || !Number.isInteger(mission.colonizationDurationSeconds ?? NaN)
    || (mission.colonizationDurationSeconds ?? 0) <= 0
    || !Number.isFinite(mission.departedAt.getTime())
    || !Number.isFinite(mission.arrivesAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.colonizationDurationSeconds * 1_000
  ) return 'ineligible';

  const jobId = colonizationArrivalJobId(mission.id);
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_JOB_STATES.has(state)) return 'existing';
      return 'retained-terminal';
    }
    await queue.add(
      COLONIZATION_ARRIVAL_JOB_NAME,
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

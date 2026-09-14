export const CORVETTE_STRIKE_ARRIVAL_JOB_NAME = 'complete-corvette-strike-arrival';
export const CORVETTE_STRIKE_RETURN_JOB_NAME = 'complete-corvette-strike-return';
export type CorvetteStrikeArrivalJobData = { missionId: string };
export type CorvetteStrikeSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface CorvetteStrikeSchedulingQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined>;
  add(name: string, data: CorvetteStrikeArrivalJobData, options: { jobId: string; delay: number; removeOnComplete: boolean; attempts: number }): Promise<unknown>;
}
export interface CorvetteStrikeSchedulingDatabase { fleetMission: any; }
const LIVE = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
export const corvetteStrikeArrivalJobId = (missionId: string) => `corvette-strike-arrival-${missionId}`;
export const corvetteStrikeReturnJobId = (missionId: string) => `corvette-strike-return-${missionId}`;

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function whole(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function valid(mission: any, kind: 'arrival' | 'return'): boolean {
  if (!mission || mission.missionType !== 'ATTACK' || !mission.corvetteStrikeOriginPlanet || !mission.corvetteStrikeTargetPlanet
    || !mission.corvetteStrikeAttacker || !mission.corvetteStrikeDefender || mission.corvetteStrikeOriginPlanetId !== mission.corvetteStrikeOriginPlanet.id
    || mission.corvetteStrikeTargetPlanetId !== mission.corvetteStrikeTargetPlanet.id || mission.corvetteStrikeAttackerId !== mission.corvetteStrikeAttacker.id
    || mission.corvetteStrikeDefenderId !== mission.corvetteStrikeDefender.id || mission.corvetteStrikeOriginPlanet.ownerId !== mission.corvetteStrikeAttacker.id
    || mission.corvetteStrikeTargetPlanet.ownerId !== mission.corvetteStrikeDefender.id || mission.corvetteStrikeAttacker.id === mission.corvetteStrikeDefender.id
    || mission.originId !== mission.corvetteStrikeOriginPlanet.id || mission.targetId !== mission.corvetteStrikeTargetPlanet.id
    || mission.targetGalaxy !== mission.corvetteStrikeTargetPlanet.galaxy || mission.targetSystem !== mission.corvetteStrikeTargetPlanet.system
    || mission.targetSlot !== mission.corvetteStrikeTargetPlanet.slot || mission.speedPercent !== 100 || !record(mission.corvetteStrikeShips)
    || Object.keys(mission.corvetteStrikeShips).length !== 1 || !whole(mission.corvetteStrikeShips.corvette) || mission.corvetteStrikeShips.corvette < 1
    || !whole(mission.corvetteStrikeOutboundFuelHeliox) || !whole(mission.corvetteStrikeReturnFuelHeliox)
    || !Number.isSafeInteger(mission.corvetteStrikeOutboundDurationSeconds) || mission.corvetteStrikeOutboundDurationSeconds <= 0
    || !Number.isSafeInteger(mission.corvetteStrikeReturnDurationSeconds) || mission.corvetteStrikeReturnDurationSeconds <= 0
    || !Number.isFinite(mission.arrivesAt?.getTime?.())) return false;
  return kind === 'arrival'
    ? mission.corvetteStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND'
    : mission.corvetteStrikePhase === 'RETURNING' && mission.status === 'RETURNING' && Number.isFinite(mission.returnsAt?.getTime?.());
}
async function schedule(database: CorvetteStrikeSchedulingDatabase, queue: CorvetteStrikeSchedulingQueue, missionId: string, kind: 'arrival' | 'return', currentTime = new Date()): Promise<CorvetteStrikeSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';
  const mission = await database.fleetMission.findUnique({ where: { id: missionId }, include: {
    corvetteStrikeOriginPlanet: { select: { id: true, ownerId: true } }, corvetteStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
    corvetteStrikeAttacker: { select: { id: true } }, corvetteStrikeDefender: { select: { id: true } },
  } });
  if (!valid(mission, kind)) return 'ineligible';
  const jobId = kind === 'arrival' ? corvetteStrikeArrivalJobId(mission.id) : corvetteStrikeReturnJobId(mission.id);
  const name = kind === 'arrival' ? CORVETTE_STRIKE_ARRIVAL_JOB_NAME : CORVETTE_STRIKE_RETURN_JOB_NAME;
  const dueAt = kind === 'arrival' ? mission.arrivesAt : mission.returnsAt;
  try {
    const existing = await queue.getJob(jobId);
    if (existing) return LIVE.has(await existing.getState()) ? 'existing' : 'retained-terminal';
    await queue.add(name, { missionId: mission.id }, { jobId, delay: Math.max(0, dueAt.getTime() - currentTime.getTime()), removeOnComplete: true, attempts: 3 });
    return 'scheduled';
  } catch { return 'failed'; }
}
export const scheduleCorvetteStrikeArrivalWakeup = (database: CorvetteStrikeSchedulingDatabase, queue: CorvetteStrikeSchedulingQueue, missionId: string, currentTime = new Date()) => schedule(database, queue, missionId, 'arrival', currentTime);
export const scheduleCorvetteStrikeReturnWakeup = (database: CorvetteStrikeSchedulingDatabase, queue: CorvetteStrikeSchedulingQueue, missionId: string, currentTime = new Date()) => schedule(database, queue, missionId, 'return', currentTime);

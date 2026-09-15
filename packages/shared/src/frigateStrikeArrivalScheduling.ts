import { FRIGATE_STRIKE_RESOLVER_VERSION } from './frigateStrike';

export const FRIGATE_STRIKE_ARRIVAL_JOB_NAME = 'complete-frigate-strike-arrival';
export const FRIGATE_STRIKE_RETURN_JOB_NAME = 'complete-frigate-strike-return';
export type FrigateStrikeArrivalJobData = { missionId: string };
export type FrigateStrikeSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface FrigateStrikeSchedulingQueue { getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined>; add(name: string, data: FrigateStrikeArrivalJobData, options: { jobId: string; delay: number; removeOnComplete: boolean; attempts: number }): Promise<unknown>; }
export interface FrigateStrikeSchedulingDatabase { fleetMission: any; }
const LIVE = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
export const frigateStrikeArrivalJobId = (missionId: string) => `frigate-strike-arrival-${missionId}`;
export const frigateStrikeReturnJobId = (missionId: string) => `frigate-strike-return-${missionId}`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function valid(mission: any, kind: 'arrival' | 'return'): boolean {
  if (!mission || mission.missionType !== 'ATTACK' || !mission.frigateStrikeOriginPlanet || !mission.frigateStrikeTargetPlanet || !mission.frigateStrikeAttacker || !mission.frigateStrikeDefender
    || mission.frigateStrikeOriginPlanetId !== mission.frigateStrikeOriginPlanet.id || mission.frigateStrikeTargetPlanetId !== mission.frigateStrikeTargetPlanet.id
    || mission.frigateStrikeAttackerId !== mission.frigateStrikeAttacker.id || mission.frigateStrikeDefenderId !== mission.frigateStrikeDefender.id
    || mission.frigateStrikeOriginPlanet.ownerId !== mission.frigateStrikeAttacker.id || mission.frigateStrikeTargetPlanet.ownerId !== mission.frigateStrikeDefender.id || mission.frigateStrikeAttacker.id === mission.frigateStrikeDefender.id
    || mission.originId !== mission.frigateStrikeOriginPlanet.id || mission.targetId !== mission.frigateStrikeTargetPlanet.id || mission.targetGalaxy !== mission.frigateStrikeTargetPlanet.galaxy || mission.targetSystem !== mission.frigateStrikeTargetPlanet.system || mission.targetSlot !== mission.frigateStrikeTargetPlanet.slot
    || mission.speedPercent !== 100 || !record(mission.frigateStrikeShips) || Object.keys(mission.frigateStrikeShips).join(',') !== 'frigate' || !whole(mission.frigateStrikeShips.frigate) || mission.frigateStrikeShips.frigate < 1
    || !whole(mission.frigateStrikeOutboundFuelHeliox) || !whole(mission.frigateStrikeReturnFuelHeliox) || !Number.isSafeInteger(mission.frigateStrikeOutboundDurationSeconds) || mission.frigateStrikeOutboundDurationSeconds <= 0 || !Number.isSafeInteger(mission.frigateStrikeReturnDurationSeconds) || mission.frigateStrikeReturnDurationSeconds <= 0 || mission.frigateStrikeResolverVersion !== FRIGATE_STRIKE_RESOLVER_VERSION || !Number.isFinite(mission.arrivesAt?.getTime?.())) return false;
  return kind === 'arrival' ? mission.frigateStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND' : mission.frigateStrikePhase === 'RETURNING' && mission.status === 'RETURNING' && Number.isFinite(mission.returnsAt?.getTime?.());
}
async function schedule(database: FrigateStrikeSchedulingDatabase, queue: FrigateStrikeSchedulingQueue, missionId: string, kind: 'arrival' | 'return', currentTime = new Date()): Promise<FrigateStrikeSchedulingOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'ineligible';
  const mission = await database.fleetMission.findUnique({ where: { id: missionId }, include: { frigateStrikeOriginPlanet: { select: { id: true, ownerId: true } }, frigateStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } }, frigateStrikeAttacker: { select: { id: true } }, frigateStrikeDefender: { select: { id: true } } } });
  if (!valid(mission, kind)) return 'ineligible';
  const jobId = kind === 'arrival' ? frigateStrikeArrivalJobId(mission.id) : frigateStrikeReturnJobId(mission.id); const name = kind === 'arrival' ? FRIGATE_STRIKE_ARRIVAL_JOB_NAME : FRIGATE_STRIKE_RETURN_JOB_NAME; const dueAt = kind === 'arrival' ? mission.arrivesAt : mission.returnsAt;
  try { const existing = await queue.getJob(jobId); if (existing) return LIVE.has(await existing.getState()) ? 'existing' : 'retained-terminal'; await queue.add(name, { missionId: mission.id }, { jobId, delay: Math.max(0, dueAt.getTime() - currentTime.getTime()), removeOnComplete: true, attempts: 3 }); return 'scheduled'; } catch { return 'failed'; }
}
export const scheduleFrigateStrikeArrivalWakeup = (database: FrigateStrikeSchedulingDatabase, queue: FrigateStrikeSchedulingQueue, missionId: string, now = new Date()) => schedule(database, queue, missionId, 'arrival', now);
export const scheduleFrigateStrikeReturnWakeup = (database: FrigateStrikeSchedulingDatabase, queue: FrigateStrikeSchedulingQueue, missionId: string, now = new Date()) => schedule(database, queue, missionId, 'return', now);

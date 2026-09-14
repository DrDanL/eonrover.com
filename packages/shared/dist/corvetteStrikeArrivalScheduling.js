"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCorvetteStrikeReturnWakeup = exports.scheduleCorvetteStrikeArrivalWakeup = exports.corvetteStrikeReturnJobId = exports.corvetteStrikeArrivalJobId = exports.CORVETTE_STRIKE_RETURN_JOB_NAME = exports.CORVETTE_STRIKE_ARRIVAL_JOB_NAME = void 0;
const corvetteStrike_1 = require("./corvetteStrike");
exports.CORVETTE_STRIKE_ARRIVAL_JOB_NAME = 'complete-corvette-strike-arrival';
exports.CORVETTE_STRIKE_RETURN_JOB_NAME = 'complete-corvette-strike-return';
const LIVE = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
const corvetteStrikeArrivalJobId = (missionId) => `corvette-strike-arrival-${missionId}`;
exports.corvetteStrikeArrivalJobId = corvetteStrikeArrivalJobId;
const corvetteStrikeReturnJobId = (missionId) => `corvette-strike-return-${missionId}`;
exports.corvetteStrikeReturnJobId = corvetteStrikeReturnJobId;
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function whole(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function valid(mission, kind) {
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
        || !(0, corvetteStrike_1.isCorvetteStrikeResolverVersion)(mission.corvetteStrikeResolverVersion)
        || !Number.isFinite(mission.arrivesAt?.getTime?.()))
        return false;
    return kind === 'arrival'
        ? mission.corvetteStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND'
        : mission.corvetteStrikePhase === 'RETURNING' && mission.status === 'RETURNING' && Number.isFinite(mission.returnsAt?.getTime?.());
}
async function schedule(database, queue, missionId, kind, currentTime = new Date()) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'ineligible';
    const mission = await database.fleetMission.findUnique({ where: { id: missionId }, include: {
            corvetteStrikeOriginPlanet: { select: { id: true, ownerId: true } }, corvetteStrikeTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
            corvetteStrikeAttacker: { select: { id: true } }, corvetteStrikeDefender: { select: { id: true } },
        } });
    if (!valid(mission, kind))
        return 'ineligible';
    const jobId = kind === 'arrival' ? (0, exports.corvetteStrikeArrivalJobId)(mission.id) : (0, exports.corvetteStrikeReturnJobId)(mission.id);
    const name = kind === 'arrival' ? exports.CORVETTE_STRIKE_ARRIVAL_JOB_NAME : exports.CORVETTE_STRIKE_RETURN_JOB_NAME;
    const dueAt = kind === 'arrival' ? mission.arrivesAt : mission.returnsAt;
    try {
        const existing = await queue.getJob(jobId);
        if (existing)
            return LIVE.has(await existing.getState()) ? 'existing' : 'retained-terminal';
        await queue.add(name, { missionId: mission.id }, { jobId, delay: Math.max(0, dueAt.getTime() - currentTime.getTime()), removeOnComplete: true, attempts: 3 });
        return 'scheduled';
    }
    catch {
        return 'failed';
    }
}
const scheduleCorvetteStrikeArrivalWakeup = (database, queue, missionId, currentTime = new Date()) => schedule(database, queue, missionId, 'arrival', currentTime);
exports.scheduleCorvetteStrikeArrivalWakeup = scheduleCorvetteStrikeArrivalWakeup;
const scheduleCorvetteStrikeReturnWakeup = (database, queue, missionId, currentTime = new Date()) => schedule(database, queue, missionId, 'return', currentTime);
exports.scheduleCorvetteStrikeReturnWakeup = scheduleCorvetteStrikeReturnWakeup;

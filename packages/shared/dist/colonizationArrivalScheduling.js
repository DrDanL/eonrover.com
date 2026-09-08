"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLONIZATION_ARRIVAL_JOB_NAME = void 0;
exports.colonizationArrivalJobId = colonizationArrivalJobId;
exports.scheduleColonizationArrivalWakeup = scheduleColonizationArrivalWakeup;
const constants_1 = require("./constants");
exports.COLONIZATION_ARRIVAL_JOB_NAME = 'complete-colony-arrival';
const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
function colonizationArrivalJobId(missionId) {
    return `colony-arrival-${missionId}`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}
function canonicalManifest(value) {
    return isRecord(value) && Object.keys(value).length === 1 && value.colonyShip === 1;
}
function canonicalCharacteristics(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ['planetType', 'temperature', 'solarIndex', 'fieldCapacity']))
        return false;
    if (typeof value.planetType !== 'string' || !(value.planetType in constants_1.PLANET_TYPES)
        || typeof value.temperature !== 'number' || typeof value.solarIndex !== 'number')
        return false;
    const profile = constants_1.PLANET_TYPES[value.planetType];
    return Number.isInteger(value.temperature)
        && value.temperature >= profile.temperatureRange[0]
        && value.temperature <= profile.temperatureRange[1]
        && Number.isFinite(value.solarIndex)
        && value.solarIndex >= profile.solarIndexRange[0]
        && value.solarIndex <= profile.solarIndexRange[1]
        && value.fieldCapacity === constants_1.COLONY_STARTER_STATE.fieldCapacity;
}
function canonicalStarterState(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ['fieldCapacity', 'resources', 'buildings'])
        || value.fieldCapacity !== constants_1.COLONY_STARTER_STATE.fieldCapacity
        || !isRecord(value.resources) || !hasOnlyKeys(value.resources, ['alloy', 'heliox', 'aether'])
        || !isRecord(value.buildings) || !hasOnlyKeys(value.buildings, Object.keys(constants_1.COLONY_STARTER_STATE.buildings)))
        return false;
    const resources = value.resources;
    const buildings = value.buildings;
    return ['alloy', 'heliox', 'aether'].every((key) => typeof resources[key] === 'number'
        && Number.isFinite(resources[key]) && resources[key] >= 0)
        && ['solarArray', 'alloyMine', 'helioxExtractor'].every((key) => typeof buildings[key] === 'number'
            && Number.isSafeInteger(buildings[key]) && buildings[key] >= 0);
}
function validTargetCoordinate(mission) {
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
async function scheduleColonizationArrivalWakeup(database, queue, missionId, currentTime = new Date()) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'ineligible';
    const mission = await database.fleetMission.findUnique({
        where: { id: missionId },
        include: {
            origin: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
            colonizationAccount: { select: { id: true } },
        },
    });
    if (!mission
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
        || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.colonizationDurationSeconds * 1_000)
        return 'ineligible';
    const jobId = colonizationArrivalJobId(mission.id);
    try {
        const existing = await queue.getJob(jobId);
        if (existing) {
            const state = await existing.getState();
            if (LIVE_JOB_STATES.has(state))
                return 'existing';
            return 'retained-terminal';
        }
        await queue.add(exports.COLONIZATION_ARRIVAL_JOB_NAME, { missionId: mission.id }, {
            jobId,
            delay: Math.max(0, mission.arrivesAt.getTime() - currentTime.getTime()),
            removeOnComplete: true,
            attempts: 3,
        });
        return 'scheduled';
    }
    catch {
        return 'failed';
    }
}

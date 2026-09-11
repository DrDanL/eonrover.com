"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESPIONAGE_PROBE_RETURN_JOB_NAME = exports.ESPIONAGE_PROBE_ARRIVAL_JOB_NAME = void 0;
exports.espionageProbeArrivalJobId = espionageProbeArrivalJobId;
exports.espionageProbeReturnJobId = espionageProbeReturnJobId;
exports.scheduleEspionageProbeArrivalWakeup = scheduleEspionageProbeArrivalWakeup;
exports.scheduleEspionageProbeReturnWakeup = scheduleEspionageProbeReturnWakeup;
exports.ESPIONAGE_PROBE_ARRIVAL_JOB_NAME = 'complete-espionage-probe-arrival';
exports.ESPIONAGE_PROBE_RETURN_JOB_NAME = 'complete-espionage-probe-return';
const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
function espionageProbeArrivalJobId(missionId) {
    return `espionage-probe-arrival-${missionId}`;
}
function espionageProbeReturnJobId(missionId) {
    return `espionage-probe-return-${missionId}`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function canonicalProbeManifest(value) {
    return isRecord(value) && Object.keys(value).length === 1 && value.probe === 1;
}
function canonicalProbeSnapshots(mission) {
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
function validMission(mission, kind) {
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
        || !canonicalProbeSnapshots(mission))
        return false;
    if (kind === 'arrival') {
        return mission.espionageProbePhase === 'OUTBOUND' && mission.status === 'OUTBOUND';
    }
    return mission.espionageProbePhase === 'RETURNING' && mission.status === 'RETURNING';
}
async function scheduleProbeWakeup(database, queue, missionId, kind, currentTime = new Date()) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'ineligible';
    const mission = await database.fleetMission.findUnique({
        where: { id: missionId },
        include: {
            espionageOriginPlanet: { select: { id: true, ownerId: true } },
            espionageTargetPlanet: { select: { id: true, ownerId: true, galaxy: true, system: true, slot: true } },
            espionageOriginAccount: { select: { id: true } },
            espionageTargetAccount: { select: { id: true } },
        },
    });
    if (!validMission(mission, kind))
        return 'ineligible';
    const jobId = kind === 'arrival' ? espionageProbeArrivalJobId(mission.id) : espionageProbeReturnJobId(mission.id);
    const jobName = kind === 'arrival' ? exports.ESPIONAGE_PROBE_ARRIVAL_JOB_NAME : exports.ESPIONAGE_PROBE_RETURN_JOB_NAME;
    const dueAt = kind === 'arrival' ? mission.arrivesAt : mission.returnsAt;
    try {
        const existing = await queue.getJob(jobId);
        if (existing)
            return LIVE_JOB_STATES.has(await existing.getState()) ? 'existing' : 'retained-terminal';
        await queue.add(jobName, { missionId: mission.id }, {
            jobId,
            delay: Math.max(0, dueAt.getTime() - currentTime.getTime()),
            removeOnComplete: true,
            attempts: 3,
        });
        return 'scheduled';
    }
    catch {
        return 'failed';
    }
}
/** Schedules only a committed canonical outbound Probe arrival wake-up. */
function scheduleEspionageProbeArrivalWakeup(database, queue, missionId, currentTime = new Date()) {
    return scheduleProbeWakeup(database, queue, missionId, 'arrival', currentTime);
}
/** Schedules only a committed canonical returning Probe wake-up. */
function scheduleEspionageProbeReturnWakeup(database, queue, missionId, currentTime = new Date()) {
    return scheduleProbeWakeup(database, queue, missionId, 'return', currentTime);
}

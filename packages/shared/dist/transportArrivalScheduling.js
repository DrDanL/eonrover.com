"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSPORT_RETURN_JOB_NAME = exports.TRANSPORT_ARRIVAL_JOB_NAME = void 0;
exports.transportArrivalJobId = transportArrivalJobId;
exports.transportReturnJobId = transportReturnJobId;
exports.scheduleTransportArrivalWakeup = scheduleTransportArrivalWakeup;
exports.scheduleTransportReturnWakeup = scheduleTransportReturnWakeup;
exports.TRANSPORT_ARRIVAL_JOB_NAME = 'complete-transport-arrival';
exports.TRANSPORT_RETURN_JOB_NAME = 'complete-transport-return';
const LIVE_JOB_STATES = new Set(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children']);
function transportArrivalJobId(missionId) {
    return `transport-arrival-${missionId}`;
}
function transportReturnJobId(missionId) {
    return `transport-return-${missionId}`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function resources(value) {
    if (!isRecord(value) || Object.keys(value).length !== 3
        || !nonNegativeSafeInteger(value.alloy)
        || !nonNegativeSafeInteger(value.heliox)
        || !nonNegativeSafeInteger(value.aether))
        return null;
    return { alloy: value.alloy, heliox: value.heliox, aether: value.aether };
}
function canonicalTransport(mission) {
    const ships = mission.transportShips;
    const cargo = resources(mission.transportCargo);
    const remaining = resources(mission.transportRemainingCargo);
    const transporter = isRecord(ships) ? ships.transporter : undefined;
    if (!isRecord(ships) || Object.keys(ships).length !== 1 || typeof transporter !== 'number' || !Number.isSafeInteger(transporter)
        || transporter < 1 || transporter > 100 || !cargo || !remaining)
        return false;
    const numericSnapshots = [
        mission.transportCapacity,
        mission.transportOutboundFuelHeliox,
        mission.transportReturnFuelHeliox,
        mission.transportTotalReservedFuelHeliox,
        mission.transportOutboundDurationSeconds,
        mission.transportReturnDurationSeconds,
    ];
    return numericSnapshots.every(nonNegativeSafeInteger)
        && mission.transportOutboundDurationSeconds > 0
        && mission.transportReturnDurationSeconds > 0
        && mission.transportTotalReservedFuelHeliox === mission.transportOutboundFuelHeliox + mission.transportReturnFuelHeliox
        && mission.transportCapacity >= cargo.alloy + cargo.heliox + cargo.aether;
}
function validMission(mission, kind) {
    if (!mission
        || mission.missionType !== 'TRANSPORT'
        || !mission.transportOrigin
        || !mission.transportDestination
        || mission.transportOriginId !== mission.transportOrigin.id
        || mission.transportDestinationId !== mission.transportDestination.id
        || mission.transportOrigin.ownerId !== mission.transportDestination.ownerId
        || mission.speedPercent !== 100
        || !canonicalTransport(mission))
        return false;
    if (kind === 'arrival') {
        return mission.status === 'OUTBOUND'
            && mission.transportPhase === 'OUTBOUND'
            && Number.isFinite(mission.arrivesAt?.getTime?.());
    }
    const remaining = resources(mission.transportRemainingCargo);
    return mission.status === 'RETURNING'
        && mission.transportPhase === 'RETURNING'
        && Boolean(remaining && remaining.alloy === 0 && remaining.heliox === 0 && remaining.aether === 0)
        && Number.isFinite(mission.returnsAt?.getTime?.());
}
async function scheduleTransportWakeup(database, queue, missionId, kind, currentTime = new Date()) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'ineligible';
    const mission = await database.fleetMission.findUnique({
        where: { id: missionId },
        include: {
            transportOrigin: { select: { id: true, ownerId: true } },
            transportDestination: { select: { id: true, ownerId: true } },
        },
    });
    if (!validMission(mission, kind))
        return 'ineligible';
    const jobId = kind === 'arrival' ? transportArrivalJobId(mission.id) : transportReturnJobId(mission.id);
    const jobName = kind === 'arrival' ? exports.TRANSPORT_ARRIVAL_JOB_NAME : exports.TRANSPORT_RETURN_JOB_NAME;
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
/** Schedules only a committed, canonical outbound transport arrival wake-up. */
function scheduleTransportArrivalWakeup(database, queue, missionId, currentTime = new Date()) {
    return scheduleTransportWakeup(database, queue, missionId, 'arrival', currentTime);
}
/** Schedules only a committed, canonical returning-Transporter wake-up. */
function scheduleTransportReturnWakeup(database, queue, missionId, currentTime = new Date()) {
    return scheduleTransportWakeup(database, queue, missionId, 'return', currentTime);
}

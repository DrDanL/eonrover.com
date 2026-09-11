"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeCanonicalColonization = completeCanonicalColonization;
const constants_1 = require("./constants");
const coordinateLock_1 = require("./coordinateLock");
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}
function nonNegativeFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function parseCanonicalManifest(value) {
    if (!isRecord(value) || Object.keys(value).length !== 1 || value.colonyShip !== 1)
        return null;
    return { colonyShip: 1 };
}
function parseCharacteristics(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ['planetType', 'temperature', 'solarIndex', 'fieldCapacity']))
        return null;
    if (typeof value.planetType !== 'string' || !(value.planetType in constants_1.PLANET_TYPES))
        return null;
    if (typeof value.temperature !== 'number' || typeof value.solarIndex !== 'number')
        return null;
    const planetType = value.planetType;
    const profile = constants_1.PLANET_TYPES[planetType];
    if (!Number.isInteger(value.temperature)
        || value.temperature < profile.temperatureRange[0]
        || value.temperature > profile.temperatureRange[1]
        || !Number.isFinite(value.solarIndex)
        || value.solarIndex < profile.solarIndexRange[0]
        || value.solarIndex > profile.solarIndexRange[1]
        || value.fieldCapacity !== constants_1.COLONY_STARTER_STATE.fieldCapacity)
        return null;
    return { planetType, temperature: value.temperature, solarIndex: value.solarIndex, fieldCapacity: constants_1.COLONY_STARTER_STATE.fieldCapacity };
}
function parseStarterState(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ['fieldCapacity', 'resources', 'buildings'])
        || value.fieldCapacity !== constants_1.COLONY_STARTER_STATE.fieldCapacity
        || !isRecord(value.resources) || !hasOnlyKeys(value.resources, ['alloy', 'heliox', 'aether'])
        || !isRecord(value.buildings) || !hasOnlyKeys(value.buildings, Object.keys(constants_1.COLONY_STARTER_STATE.buildings)))
        return null;
    const resources = value.resources;
    const buildings = value.buildings;
    if (!nonNegativeFiniteNumber(resources.alloy)
        || !nonNegativeFiniteNumber(resources.heliox)
        || !nonNegativeFiniteNumber(resources.aether)
        || !nonNegativeInteger(buildings.solarArray)
        || !nonNegativeInteger(buildings.alloyMine)
        || !nonNegativeInteger(buildings.helioxExtractor))
        return null;
    return {
        fieldCapacity: constants_1.COLONY_STARTER_STATE.fieldCapacity,
        resources: { alloy: resources.alloy, heliox: resources.heliox, aether: resources.aether },
        buildings: { solarArray: buildings.solarArray, alloyMine: buildings.alloyMine, helioxExtractor: buildings.helioxExtractor },
    };
}
function isRetryableTransactionError(error) {
    return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}
function isCoordinateConflict(error) {
    if (error?.code !== 'P2002')
        return false;
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(' ') : String(error.meta?.target ?? '');
    return target.includes('galaxy') || target.includes('system') || target.includes('slot');
}
function preflightCoordinate(mission) {
    if (mission.missionType !== 'COLONIZE' || mission.status !== 'OUTBOUND')
        return null;
    const { colonizationTargetGalaxy: galaxy, colonizationTargetSystem: system, colonizationTargetSlot: slot } = mission;
    if (typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy) || galaxy < 1
        || typeof system !== 'number' || !Number.isSafeInteger(system) || system < 1
        || typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 1 || slot > 12)
        return null;
    return { galaxy, system, slot };
}
const PLANET_TYPE_TO_DB = {
    temperate: 'TEMPERATE', volcanic: 'VOLCANIC', ice: 'ICE', gasGiant: 'GAS_GIANT', barren: 'BARREN', oceanic: 'OCEANIC',
};
/**
 * The single PostgreSQL-authoritative canonical colonisation arrival path.
 * Callers provide only a mission identifier and a time boundary; legacy JSON
 * and all queued data are intentionally excluded from this authority source.
 */
async function completeCanonicalColonization(database, missionId, currentTime = new Date()) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'noop';
    const preliminary = await database.fleetMission.findUnique({
        where: { id: missionId },
        select: { missionType: true, status: true, colonizationTargetGalaxy: true, colonizationTargetSystem: true, colonizationTargetSlot: true },
    });
    if (!preliminary)
        return 'noop';
    const coordinate = preflightCoordinate(preliminary);
    if (!coordinate)
        return 'noop';
    for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await database.$transaction(async (tx) => {
                // account → origin → target-coordinate lock → mission → target planet
                const accountLocks = await tx.$queryRaw `
          SELECT account."id" AS "id" FROM "User" AS account
          JOIN "Planet" AS origin ON origin."ownerId" = account."id"
          JOIN "FleetMission" AS mission ON mission."originId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF account
        `;
                if (accountLocks.length !== 1)
                    return 'noop';
                const account = await tx.user.findUnique({ where: { id: accountLocks[0].id }, select: { id: true } });
                if (!account)
                    return 'noop';
                const originLocks = await tx.$queryRaw `
          SELECT origin."id" AS "id" FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."originId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF origin
        `;
                if (originLocks.length !== 1)
                    return 'noop';
                const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
                if (!origin)
                    return 'noop';
                await (0, coordinateLock_1.lockCoordinateForTransaction)(tx, coordinate);
                await tx.$queryRaw `SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
                const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
                if (!mission || mission.missionType !== 'COLONIZE' || mission.status !== 'OUTBOUND')
                    return 'noop';
                const ships = parseCanonicalManifest(mission.colonizationShips);
                const characteristics = parseCharacteristics(mission.colonizationCharacteristics);
                const starterState = parseStarterState(mission.colonizationStarterState);
                const canonicalCoordinate = preflightCoordinate(mission);
                const canonicalTiming = Number.isSafeInteger(mission.colonizationDurationSeconds)
                    && mission.colonizationDurationSeconds > 0
                    && Number.isSafeInteger(mission.colonizationFuelHeliox)
                    && mission.colonizationFuelHeliox >= 0
                    && Number.isFinite(mission.departedAt.getTime())
                    && Number.isFinite(mission.arrivesAt.getTime())
                    && mission.arrivesAt.getTime() - mission.departedAt.getTime() === mission.colonizationDurationSeconds * 1_000;
                if (!ships || !characteristics || !starterState || !canonicalCoordinate || !canonicalTiming
                    || mission.colonizationAccountId !== account.id || origin.ownerId !== account.id || mission.originId !== origin.id
                    || mission.targetGalaxy !== canonicalCoordinate.galaxy || mission.targetSystem !== canonicalCoordinate.system || mission.targetSlot !== canonicalCoordinate.slot
                    || canonicalCoordinate.galaxy !== coordinate.galaxy || canonicalCoordinate.system !== coordinate.system || canonicalCoordinate.slot !== coordinate.slot
                    || canonicalCoordinate.galaxy !== origin.galaxy || canonicalCoordinate.system !== origin.system || canonicalCoordinate.slot === origin.slot
                    || mission.speedPercent !== 100 || mission.createdPlanetId !== null)
                    return 'noop';
                if (mission.arrivesAt > currentTime)
                    return 'early';
                const occupiedTarget = await tx.planet.findUnique({ where: { galaxy_system_slot: canonicalCoordinate }, select: { id: true } });
                if (occupiedTarget) {
                    const failure = await tx.fleetMission.updateMany({
                        where: { id: mission.id, status: 'OUTBOUND', createdPlanetId: null },
                        data: { status: 'COMPLETE', resultSummary: { colonizationOutcome: 'TARGET_OCCUPIED' } },
                    });
                    if (failure.count !== 1)
                        return 'noop';
                    await tx.$queryRaw `SELECT "id" FROM "Ship" WHERE "planetId" = ${origin.id} AND "key" = 'colonyShip' FOR UPDATE`;
                    const restored = await tx.ship.updateMany({ where: { planetId: origin.id, key: 'colonyShip' }, data: { count: { increment: 1 } } });
                    if (restored.count === 0)
                        await tx.ship.create({ data: { planetId: origin.id, key: 'colonyShip', count: 1 } });
                    await tx.notification.create({ data: { userId: account.id, type: 'COLONY_FAILED', message: 'Colonisation failed because the target coordinate is no longer available.' } });
                    return 'failed';
                }
                const colony = await tx.planet.create({
                    data: {
                        ownerId: account.id,
                        name: `Colony ${canonicalCoordinate.galaxy}:${canonicalCoordinate.system}:${canonicalCoordinate.slot}`,
                        galaxy: canonicalCoordinate.galaxy, system: canonicalCoordinate.system, slot: canonicalCoordinate.slot,
                        planetType: PLANET_TYPE_TO_DB[characteristics.planetType], temperature: characteristics.temperature, solarIndex: characteristics.solarIndex,
                        fieldCapacity: starterState.fieldCapacity,
                        alloy: starterState.resources.alloy, heliox: starterState.resources.heliox, aether: starterState.resources.aether,
                        lastProductionAt: currentTime,
                        buildings: { create: Object.entries(starterState.buildings).map(([key, level]) => ({ key, level })) },
                    },
                });
                const transition = await tx.fleetMission.updateMany({
                    where: { id: mission.id, status: 'OUTBOUND', createdPlanetId: null },
                    data: { status: 'COMPLETE', createdPlanetId: colony.id, resultSummary: { colonizationOutcome: 'FOUNDED' } },
                });
                if (transition.count !== 1)
                    return 'noop';
                await tx.notification.create({ data: { userId: account.id, type: 'COLONY_FOUNDED', message: 'A new colony has been founded.' } });
                return 'completed';
            }, { isolationLevel: 'Serializable' });
        }
        catch (error) {
            if (isCoordinateConflict(error)) {
                if (attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS)
                    continue;
                return 'unavailable';
            }
            if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS)
                continue;
            if (isRetryableTransactionError(error))
                return 'unavailable';
            throw error;
        }
    }
    return 'unavailable';
}

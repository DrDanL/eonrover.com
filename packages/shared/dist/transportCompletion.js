"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleCanonicalTransport = settleCanonicalTransport;
const formulas_1 = require("./formulas");
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function resourceSnapshot(value) {
    if (!isRecord(value) || Object.keys(value).length !== 3)
        return null;
    const { alloy, heliox, aether } = value;
    if (!nonNegativeSafeInteger(alloy) || !nonNegativeSafeInteger(heliox) || !nonNegativeSafeInteger(aether))
        return null;
    return { alloy, heliox, aether };
}
function transporterSnapshot(value) {
    if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.transporter !== 'number')
        return null;
    if (!Number.isSafeInteger(value.transporter) || value.transporter < 1 || value.transporter > 100)
        return null;
    return { transporter: value.transporter };
}
function canonicalTransport(mission) {
    const ships = transporterSnapshot(mission.transportShips);
    const originalCargo = resourceSnapshot(mission.transportCargo);
    const remainingCargo = resourceSnapshot(mission.transportRemainingCargo);
    if (!ships || !originalCargo || !remainingCargo
        || !nonNegativeSafeInteger(mission.transportCapacity)
        || !nonNegativeSafeInteger(mission.transportOutboundFuelHeliox)
        || !nonNegativeSafeInteger(mission.transportReturnFuelHeliox)
        || !nonNegativeSafeInteger(mission.transportTotalReservedFuelHeliox)
        || !nonNegativeSafeInteger(mission.transportOutboundDurationSeconds)
        || !nonNegativeSafeInteger(mission.transportReturnDurationSeconds)
        || mission.transportOutboundDurationSeconds === 0 || mission.transportReturnDurationSeconds === 0
        || mission.transportTotalReservedFuelHeliox !== mission.transportOutboundFuelHeliox + mission.transportReturnFuelHeliox
        || mission.transportCapacity < originalCargo.alloy + originalCargo.heliox + originalCargo.aether)
        return null;
    return { ships, originalCargo, remainingCargo, returnDurationSeconds: mission.transportReturnDurationSeconds };
}
function sameResources(left, right) {
    return left.alloy === right.alloy && left.heliox === right.heliox && left.aether === right.aether;
}
function zeroResources(value) {
    return value.alloy === 0 && value.heliox === 0 && value.aether === 0;
}
function capacitiesFor(buildings) {
    const levels = new Map(buildings.map((building) => [building.key, building.level]));
    return {
        alloy: (0, formulas_1.storageCapacity)(levels.get('alloyStorage') ?? 0),
        heliox: (0, formulas_1.storageCapacity)(levels.get('helioxStorage') ?? 0),
        aether: (0, formulas_1.storageCapacity)(levels.get('aetherStorage') ?? 0),
    };
}
function fits(resources, capacity, cargo) {
    return resources.alloy + cargo.alloy <= capacity.alloy
        && resources.heliox + cargo.heliox <= capacity.heliox
        && resources.aether + cargo.aether <= capacity.aether;
}
function isRetryableTransactionError(error) {
    return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}
function environment(planet) {
    const typeByDatabaseValue = {
        TEMPERATE: 'temperate', VOLCANIC: 'volcanic', ICE: 'ice', GAS_GIANT: 'gasGiant', BARREN: 'barren', OCEANIC: 'oceanic',
    };
    return { type: typeByDatabaseValue[planet.planetType] ?? 'temperate', temperature: planet.temperature, solarIndex: planet.solarIndex };
}
async function economySpeed(tx) {
    const row = await tx.universeSetting.findUnique({ where: { key: 'economySpeed' }, select: { value: true } });
    return typeof row?.value === 'number' && Number.isFinite(row.value) && row.value > 0 ? row.value : 1;
}
async function syncLockedPlanetResources(tx, planet, currentTime, speed) {
    const buildings = await tx.building.findMany({ where: { planetId: planet.id } });
    const levels = new Map(buildings.map((building) => [building.key, building.level]));
    const buildingLevels = Object.fromEntries(levels);
    const energy = (0, formulas_1.calculatePlanetEnergy)(buildingLevels, planet.solarIndex);
    const production = (0, formulas_1.calculatePlanetProduction)({
        previousProductionAt: planet.lastProductionAt,
        currentTime,
        resources: { alloy: planet.alloy, heliox: planet.heliox, aether: planet.aether },
        buildingLevels,
        environment: environment(planet),
        storage: capacitiesFor(buildings),
        energySupply: energy.supply,
        energyDemand: energy.demand,
        economySpeed: speed,
        productionModifier: 1,
    });
    const changed = production.resources.alloy !== planet.alloy
        || production.resources.heliox !== planet.heliox
        || production.resources.aether !== planet.aether
        || production.lastProductionAt.getTime() !== planet.lastProductionAt.getTime();
    const updated = changed ? await tx.planet.update({
        where: { id: planet.id },
        data: { ...production.resources, lastProductionAt: production.lastProductionAt },
    }) : planet;
    return { planet: updated, buildings };
}
/**
 * The single PostgreSQL-authoritative transport state transition. Redis is
 * deliberately absent from this transaction; callers may attach a best-effort
 * post-commit return wake-up after a delivery has committed.
 */
async function settleCanonicalTransport(database, missionId, currentTime = new Date(), options = {}) {
    if (!missionId || !Number.isFinite(currentTime.getTime()))
        return 'noop';
    for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            const outcome = await database.$transaction(async (tx) => {
                // account → origin → destination → mission → destination resources / origin inventory
                const accountLocks = await tx.$queryRaw `
          SELECT account."id" AS "id" FROM "User" AS account
          JOIN "Planet" AS origin ON origin."ownerId" = account."id"
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF account
        `;
                if (accountLocks.length !== 1)
                    return 'noop';
                const account = await tx.user.findUnique({ where: { id: accountLocks[0].id }, select: { id: true } });
                if (!account)
                    return 'noop';
                const originLocks = await tx.$queryRaw `
          SELECT origin."id" AS "id" FROM "Planet" AS origin
          JOIN "FleetMission" AS mission ON mission."transportOriginId" = origin."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF origin
        `;
                if (originLocks.length !== 1)
                    return 'noop';
                const origin = await tx.planet.findUnique({ where: { id: originLocks[0].id } });
                if (!origin)
                    return 'noop';
                const destinationLocks = await tx.$queryRaw `
          SELECT destination."id" AS "id" FROM "Planet" AS destination
          JOIN "FleetMission" AS mission ON mission."transportDestinationId" = destination."id"
          WHERE mission."id" = ${missionId} FOR UPDATE OF destination
        `;
                if (destinationLocks.length !== 1)
                    return 'noop';
                const destination = await tx.planet.findUnique({ where: { id: destinationLocks[0].id } });
                if (!destination)
                    return 'noop';
                await tx.$queryRaw `SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
                const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
                if (!mission || mission.missionType !== 'TRANSPORT' || !mission.transportPhase
                    || mission.transportOriginId !== origin.id || mission.transportDestinationId !== destination.id
                    || origin.ownerId !== account.id || destination.ownerId !== account.id || mission.speedPercent !== 100
                    || !Number.isFinite(mission.arrivesAt.getTime()))
                    return 'noop';
                const canonical = canonicalTransport(mission);
                if (!canonical)
                    return 'noop';
                if (mission.transportPhase === 'OUTBOUND' || mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY') {
                    if (mission.status !== 'OUTBOUND' || !sameResources(canonical.originalCargo, canonical.remainingCargo))
                        return 'noop';
                    if (mission.transportPhase === 'OUTBOUND' && mission.arrivesAt > currentTime)
                        return 'early';
                    const synced = await syncLockedPlanetResources(tx, destination, currentTime, await economySpeed(tx));
                    if (!fits(synced.planet, capacitiesFor(synced.buildings), canonical.remainingCargo)) {
                        if (mission.transportPhase === 'AWAITING_DESTINATION_CAPACITY')
                            return 'awaiting-capacity';
                        const wait = await tx.fleetMission.updateMany({
                            where: { id: mission.id, transportPhase: 'OUTBOUND', status: 'OUTBOUND' },
                            data: { transportPhase: 'AWAITING_DESTINATION_CAPACITY' },
                        });
                        if (wait.count === 1)
                            await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_AWAITING_CAPACITY', message: 'A transport mission is waiting for destination storage capacity.' } });
                        return wait.count === 1 ? 'awaiting-capacity' : 'noop';
                    }
                    const returnsAt = new Date(currentTime.getTime() + canonical.returnDurationSeconds * 1_000);
                    const delivered = await tx.fleetMission.updateMany({
                        where: { id: mission.id, status: 'OUTBOUND', transportPhase: { in: ['OUTBOUND', 'AWAITING_DESTINATION_CAPACITY'] } },
                        data: { status: 'RETURNING', transportPhase: 'RETURNING', transportRemainingCargo: { alloy: 0, heliox: 0, aether: 0 }, returnsAt },
                    });
                    if (delivered.count !== 1)
                        return 'noop';
                    await tx.planet.update({ where: { id: synced.planet.id }, data: {
                            alloy: synced.planet.alloy + canonical.remainingCargo.alloy,
                            heliox: synced.planet.heliox + canonical.remainingCargo.heliox,
                            aether: synced.planet.aether + canonical.remainingCargo.aether,
                        } });
                    await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_DELIVERED', message: 'A transport mission has delivered its cargo and is returning.' } });
                    return 'delivered';
                }
                if (mission.transportPhase !== 'RETURNING' || mission.status !== 'RETURNING' || !mission.returnsAt
                    || !Number.isFinite(mission.returnsAt.getTime()) || !zeroResources(canonical.remainingCargo))
                    return 'noop';
                if (mission.returnsAt > currentTime)
                    return 'early';
                await tx.$queryRaw `SELECT "id" FROM "Ship" WHERE "planetId" = ${origin.id} AND "key" = 'transporter' FOR UPDATE`;
                const completed = await tx.fleetMission.updateMany({
                    where: { id: mission.id, transportPhase: 'RETURNING', status: 'RETURNING' },
                    data: { transportPhase: 'COMPLETE', status: 'COMPLETE' },
                });
                if (completed.count !== 1)
                    return 'noop';
                await tx.ship.upsert({
                    where: { planetId_key: { planetId: origin.id, key: 'transporter' } },
                    update: { count: { increment: canonical.ships.transporter } },
                    create: { planetId: origin.id, key: 'transporter', count: canonical.ships.transporter },
                });
                await tx.notification.create({ data: { userId: account.id, type: 'TRANSPORT_RETURNED', message: 'Transporters have returned to their origin planet.' } });
                return 'returned';
            }, { isolationLevel: 'Serializable' });
            if (outcome === 'delivered')
                await options.scheduleReturnWakeup?.(missionId, currentTime);
            return outcome;
        }
        catch (error) {
            if (isRetryableTransactionError(error) && attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS)
                continue;
            if (isRetryableTransactionError(error))
                return 'unavailable';
            throw error;
        }
    }
    return 'unavailable';
}

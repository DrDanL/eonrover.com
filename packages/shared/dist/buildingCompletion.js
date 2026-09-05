"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildingCompletionInvariantError = exports.BUILD_COMPLETION_TRANSACTION_ATTEMPTS = exports.BUILD_COMPLETION_JOB_NAME = void 0;
exports.buildCompletionJobId = buildCompletionJobId;
exports.completeBuildingConstruction = completeBuildingConstruction;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
exports.BUILD_COMPLETION_JOB_NAME = 'complete-building';
exports.BUILD_COMPLETION_TRANSACTION_ATTEMPTS = 3;
function buildCompletionJobId(constructionId) {
    return `building-${constructionId}`;
}
class BuildingCompletionInvariantError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BuildingCompletionInvariantError';
    }
}
exports.BuildingCompletionInvariantError = BuildingCompletionInvariantError;
function settleProduction(planet, state, buildingLevels, currentTime, economySpeed, preserveExistingMinimum = false) {
    let energySupply = constants_1.BASE_ENERGY_SUPPLY;
    let energyDemand = 0;
    for (const [key, level] of Object.entries(buildingLevels)) {
        const definition = constants_1.BUILDINGS[key];
        if (!definition)
            continue;
        const energy = (0, formulas_1.buildingEnergy)(definition.key, level, planet.environment.solarIndex);
        if (energy >= 0)
            energyDemand += energy;
        else
            energySupply += -energy;
    }
    const production = (0, formulas_1.calculatePlanetProduction)({
        previousProductionAt: state.lastProductionAt,
        currentTime,
        resources: state.resources,
        buildingLevels,
        environment: planet.environment,
        storage: {
            alloy: (0, formulas_1.storageCapacity)(buildingLevels.alloyStorage ?? 0),
            heliox: (0, formulas_1.storageCapacity)(buildingLevels.helioxStorage ?? 0),
            aether: (0, formulas_1.storageCapacity)(buildingLevels.aetherStorage ?? 0),
        },
        energySupply,
        energyDemand,
        economySpeed,
        // Research production bonuses remain deliberately deferred from Stage 3A.
        productionModifier: 1,
    });
    return {
        resources: preserveExistingMinimum
            ? {
                alloy: Math.max(state.resources.alloy, production.resources.alloy),
                heliox: Math.max(state.resources.heliox, production.resources.heliox),
                aether: Math.max(state.resources.aether, production.resources.aether),
            }
            : production.resources,
        lastProductionAt: production.lastProductionAt,
    };
}
function calculateCompletionTransition(planet, buildings, construction, processingTime, economySpeed) {
    if (!(construction.buildingKey in constants_1.BUILDINGS)) {
        throw new BuildingCompletionInvariantError(`Unknown building key on construction ${construction.id}`);
    }
    const key = construction.buildingKey;
    const buildingLevels = Object.fromEntries(buildings.map((building) => [building.key, building.level]));
    const currentLevel = buildingLevels[key] ?? 0;
    if (construction.targetLevel !== currentLevel + 1) {
        throw new BuildingCompletionInvariantError(`Invalid target level on construction ${construction.id}`);
    }
    const finishTime = construction.completesAt.getTime();
    const processingTimestamp = processingTime.getTime();
    if (!Number.isFinite(finishTime) || !Number.isFinite(processingTimestamp)) {
        throw new BuildingCompletionInvariantError(`Invalid completion timestamp on construction ${construction.id}`);
    }
    let state = {
        resources: planet.resources,
        lastProductionAt: planet.lastProductionAt,
    };
    const legacyPastFinish = planet.lastProductionAt.getTime() > finishTime;
    // Legacy rows may already have been settled beyond the finish time with the
    // old level. That interval cannot be reconstructed safely, so retain those
    // balances and apply the new level only from the stored timestamp onward.
    if (planet.lastProductionAt.getTime() < finishTime) {
        state = settleProduction(planet, state, buildingLevels, construction.completesAt, economySpeed);
    }
    const completedLevels = { ...buildingLevels, [key]: construction.targetLevel };
    state = settleProduction(planet, state, completedLevels, processingTime, economySpeed, legacyPastFinish);
    return { ...state, legacyPastFinish };
}
/**
 * Completes one persisted building construction. PostgreSQL adapters provide
 * the transaction and row locks; this shared operation owns the transition,
 * idempotency checks, production split, and notification write order.
 */
async function completeBuildingConstruction(store, constructionId, processingTime, economySpeed) {
    for (let attempt = 1; attempt <= exports.BUILD_COMPLETION_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await store.transaction(async (tx) => {
                const initial = await tx.findConstruction(constructionId);
                if (!initial)
                    return { outcome: 'missing' };
                // Cancellation uses the same planet -> construction lock order.
                const planet = await tx.lockPlanet(initial.planetId);
                if (!planet)
                    return { outcome: 'missing' };
                const construction = await tx.lockConstruction(constructionId, planet.id);
                if (!construction)
                    return { outcome: 'missing' };
                if (construction.status === 'COMPLETE')
                    return { outcome: 'already-complete' };
                if (construction.status === 'CANCELLED')
                    return { outcome: 'cancelled' };
                if (processingTime.getTime() < construction.completesAt.getTime()) {
                    return { outcome: 'too-early', completesAt: construction.completesAt };
                }
                const buildings = await tx.listBuildings(planet.id);
                const transition = calculateCompletionTransition(planet, buildings, construction, processingTime, economySpeed);
                const claimed = await tx.markConstructionComplete(construction.id);
                if (!claimed) {
                    throw new BuildingCompletionInvariantError(`Construction ${construction.id} lost its completion claim`);
                }
                await tx.updatePlanetResources(planet.id, transition.resources, transition.lastProductionAt);
                await tx.setBuildingLevel(planet.id, construction.buildingKey, construction.targetLevel);
                await tx.createCompletionNotification(planet.ownerId, `${construction.buildingKey} reached level ${construction.targetLevel} on ${planet.name}.`);
                return { outcome: 'completed', legacyPastFinish: transition.legacyPastFinish };
            });
        }
        catch (error) {
            if (!store.isRetryableTransactionError(error) || attempt === exports.BUILD_COMPLETION_TRANSACTION_ATTEMPTS) {
                throw error;
            }
        }
    }
    throw new Error('Building completion exhausted its retry limit');
}

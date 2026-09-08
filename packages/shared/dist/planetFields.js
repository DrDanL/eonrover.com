"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PLANET_FIELD_CAPACITY = void 0;
exports.calculatePlanetFields = calculatePlanetFields;
const constants_1 = require("./constants");
Object.defineProperty(exports, "DEFAULT_PLANET_FIELD_CAPACITY", { enumerable: true, get: function () { return constants_1.DEFAULT_PLANET_FIELD_CAPACITY; } });
function assertPositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive integer`);
    }
}
function weightedTotal(values, label) {
    let total = 0;
    for (const [rawKey, value] of Object.entries(values)) {
        if (!(rawKey in constants_1.BUILDINGS))
            throw new RangeError(`${label} contains an unknown building key`);
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError(`${label} must contain non-negative integers`);
        }
        total += value * constants_1.BUILDINGS[rawKey].fieldCost;
    }
    if (!Number.isSafeInteger(total))
        throw new RangeError(`${label} total must be a safe integer`);
    return total;
}
function calculatePlanetFields(input) {
    assertPositiveInteger(input.capacity, 'Planet field capacity');
    if (!(input.proposedBuildingKey in constants_1.BUILDINGS)) {
        throw new RangeError('Proposed upgrade contains an unknown building key');
    }
    const completedUsed = weightedTotal(input.buildingLevels, 'Building levels');
    const reserved = weightedTotal(input.pendingConstructionCounts ?? {}, 'Pending construction counts');
    const requiredForUpgrade = constants_1.BUILDINGS[input.proposedBuildingKey].fieldCost;
    assertPositiveInteger(requiredForUpgrade, 'Building field cost');
    const occupied = completedUsed + reserved;
    const projectedOccupied = occupied + requiredForUpgrade;
    if (![occupied, projectedOccupied].every(Number.isSafeInteger)) {
        throw new RangeError('Planet field results must be safe integers');
    }
    const available = Math.max(0, input.capacity - occupied);
    const projectedAvailable = Math.max(0, input.capacity - projectedOccupied);
    const shortfall = Math.max(0, projectedOccupied - input.capacity);
    return {
        capacity: input.capacity,
        completedUsed,
        reserved,
        occupied,
        available,
        projectedOccupied,
        projectedAvailable,
        requiredForUpgrade,
        isAtCapacity: occupied === input.capacity,
        isOverCapacity: occupied > input.capacity,
        canConstruct: projectedOccupied <= input.capacity,
        shortfall,
    };
}

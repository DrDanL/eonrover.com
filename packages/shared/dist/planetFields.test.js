"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const planetFields_1 = require("./planetFields");
const buildingPrerequisites_1 = require("./buildingPrerequisites");
const planetFields_2 = require("./planetFields");
(0, node_test_1.test)('calculates an empty planet and its next field projection', () => {
    strict_1.default.deepEqual((0, planetFields_1.calculatePlanetFields)({
        capacity: 180,
        buildingLevels: {},
        proposedBuildingKey: 'alloyMine',
    }), {
        capacity: 180,
        completedUsed: 0,
        reserved: 0,
        occupied: 0,
        available: 180,
        projectedOccupied: 1,
        projectedAvailable: 179,
        requiredForUpgrade: 1,
        isAtCapacity: false,
        isOverCapacity: false,
        canConstruct: true,
        shortfall: 0,
    });
});
(0, node_test_1.test)('sums normal completed usage and ignores level-zero buildings', () => {
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: 20,
        buildingLevels: { alloyMine: 4, helioxExtractor: 3, solarArray: 0, researchLab: 2 },
        proposedBuildingKey: 'researchLab',
    });
    strict_1.default.equal(fields.completedUsed, 9);
    strict_1.default.equal(fields.occupied, 9);
    strict_1.default.equal(fields.available, 11);
});
(0, node_test_1.test)('counts one accepted pending construction as one reserved field', () => {
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: 20,
        buildingLevels: { alloyMine: 4 },
        pendingConstructionCounts: { solarArray: 1 },
        proposedBuildingKey: 'alloyMine',
    });
    strict_1.default.equal(fields.completedUsed, 4);
    strict_1.default.equal(fields.reserved, 1);
    strict_1.default.equal(fields.occupied, 5);
});
(0, node_test_1.test)('allows an upgrade that reaches exact capacity', () => {
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: 5,
        buildingLevels: { alloyMine: 4 },
        proposedBuildingKey: 'solarArray',
    });
    strict_1.default.equal(fields.projectedOccupied, 5);
    strict_1.default.equal(fields.projectedAvailable, 0);
    strict_1.default.equal(fields.canConstruct, true);
    strict_1.default.equal(fields.shortfall, 0);
});
(0, node_test_1.test)('reports a one-field shortfall beyond capacity', () => {
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: 4,
        buildingLevels: { alloyMine: 4 },
        proposedBuildingKey: 'solarArray',
    });
    strict_1.default.equal(fields.available, 0);
    strict_1.default.equal(fields.projectedOccupied, 5);
    strict_1.default.equal(fields.canConstruct, false);
    strict_1.default.equal(fields.shortfall, 1);
});
(0, node_test_1.test)('cancellation releases a reservation without changing completed use', () => {
    const pending = (0, planetFields_1.calculatePlanetFields)({
        capacity: 5,
        buildingLevels: { alloyMine: 4 },
        pendingConstructionCounts: { solarArray: 1 },
        proposedBuildingKey: 'solarArray',
    });
    const cancelled = (0, planetFields_1.calculatePlanetFields)({
        capacity: 5,
        buildingLevels: { alloyMine: 4 },
        proposedBuildingKey: 'solarArray',
    });
    strict_1.default.equal(pending.reserved, 1);
    strict_1.default.equal(cancelled.reserved, 0);
    strict_1.default.equal(cancelled.available, pending.available + 1);
    strict_1.default.equal(cancelled.completedUsed, pending.completedUsed);
});
(0, node_test_1.test)('completion converts a reservation to completed use without double counting', () => {
    const pending = (0, planetFields_1.calculatePlanetFields)({
        capacity: 5,
        buildingLevels: { alloyMine: 4 },
        pendingConstructionCounts: { solarArray: 1 },
        proposedBuildingKey: 'alloyMine',
    });
    const completed = (0, planetFields_1.calculatePlanetFields)({
        capacity: 5,
        buildingLevels: { alloyMine: 4, solarArray: 1 },
        proposedBuildingKey: 'alloyMine',
    });
    strict_1.default.equal(pending.occupied, 5);
    strict_1.default.equal(completed.occupied, 5);
    strict_1.default.equal(completed.completedUsed, 5);
    strict_1.default.equal(completed.reserved, 0);
});
(0, node_test_1.test)('rejects negative, fractional, non-finite, and invalid reservation input', () => {
    const base = { capacity: 5, proposedBuildingKey: 'alloyMine' };
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({ ...base, buildingLevels: { alloyMine: -1 } }), RangeError);
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({ ...base, buildingLevels: { alloyMine: 0.5 } }), RangeError);
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({ ...base, buildingLevels: { alloyMine: Number.NaN } }), RangeError);
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({
        ...base,
        buildingLevels: {},
        pendingConstructionCounts: { solarArray: -1 },
    }), RangeError);
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({ ...base, capacity: 0, buildingLevels: {} }), RangeError);
    strict_1.default.throws(() => (0, planetFields_1.calculatePlanetFields)({ ...base, capacity: 2.5, buildingLevels: {} }), RangeError);
});
(0, node_test_1.test)('handles legacy over-capacity state with safe non-negative availability', () => {
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: 3,
        buildingLevels: { alloyMine: 4, solarArray: 1 },
        pendingConstructionCounts: { helioxExtractor: 1 },
        proposedBuildingKey: 'alloyMine',
    });
    strict_1.default.equal(fields.completedUsed, 5);
    strict_1.default.equal(fields.reserved, 1);
    strict_1.default.equal(fields.occupied, 6);
    strict_1.default.equal(fields.available, 0);
    strict_1.default.equal(fields.projectedAvailable, 0);
    strict_1.default.equal(fields.isAtCapacity, false);
    strict_1.default.equal(fields.isOverCapacity, true);
    strict_1.default.equal(fields.canConstruct, false);
    strict_1.default.equal(fields.shortfall, 4);
});
(0, node_test_1.test)('returns deterministic results for identical input', () => {
    const input = {
        capacity: 180,
        buildingLevels: { alloyMine: 2, solarArray: 3 },
        pendingConstructionCounts: { researchLab: 1 },
        proposedBuildingKey: 'helioxExtractor',
    };
    strict_1.default.deepEqual((0, planetFields_1.calculatePlanetFields)(input), (0, planetFields_1.calculatePlanetFields)(input));
});
(0, node_test_1.test)('default capacity leaves substantial headroom after the minimum Gate Observatory prerequisite chain', () => {
    const minimumGateEligibilityLevels = {
        researchLab: 3,
        aetherSynthesizer: 2,
        solarArray: 4,
    };
    strict_1.default.equal((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('gateObservatory', minimumGateEligibilityLevels)?.meetsPrerequisites, true);
    const fields = (0, planetFields_1.calculatePlanetFields)({
        capacity: planetFields_2.DEFAULT_PLANET_FIELD_CAPACITY,
        buildingLevels: minimumGateEligibilityLevels,
        proposedBuildingKey: 'gateObservatory',
    });
    strict_1.default.equal(fields.completedUsed, 9);
    strict_1.default.equal(fields.projectedOccupied, 10);
    strict_1.default.equal(fields.projectedAvailable, 170);
    strict_1.default.equal(fields.canConstruct, true);
});

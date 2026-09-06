"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const gamePresentation_1 = require("./gamePresentation");
(0, node_test_1.test)('projects visual resource growth from an authoritative server timestamp', () => {
    strict_1.default.equal((0, gamePresentation_1.projectVisualResourceAmount)({
        amount: 100,
        hourlyRate: 60,
        capacity: 1_000,
        serverTimestampMs: 1_000,
        displayTimestampMs: 31_000,
    }), 100.5);
});
(0, node_test_1.test)('caps a visual resource projection at storage capacity', () => {
    strict_1.default.equal((0, gamePresentation_1.projectVisualResourceAmount)({
        amount: 995,
        hourlyRate: 60,
        capacity: 1_000,
        serverTimestampMs: 0,
        displayTimestampMs: 3_600_000,
    }), 1_000);
});
(0, node_test_1.test)('keeps a zero-production resource unchanged', () => {
    strict_1.default.equal((0, gamePresentation_1.projectVisualResourceAmount)({
        amount: 75,
        hourlyRate: 0,
        capacity: 100,
        serverTimestampMs: 0,
        displayTimestampMs: 3_600_000,
    }), 75);
});
(0, node_test_1.test)('calculates time until storage is full and handles full or idle storage', () => {
    strict_1.default.equal((0, gamePresentation_1.timeUntilStorageFullSeconds)(700, 100, 1_000), 10_800);
    strict_1.default.equal((0, gamePresentation_1.timeUntilStorageFullSeconds)(1_000, 100, 1_000), 0);
    strict_1.default.equal((0, gamePresentation_1.timeUntilStorageFullSeconds)(700, 0, 1_000), null);
});
(0, node_test_1.test)('selects the deterministic first missing resource building', () => {
    const action = (0, gamePresentation_1.selectPlanetNextAction)({
        activeConstruction: null,
        energyStatus: 'healthy',
        energyBlockedBuildingKeys: [],
        buildingLevels: { alloyMine: 1, helioxExtractor: 0, aetherSynthesizer: 0 },
    });
    strict_1.default.equal(action.kind, 'heliox');
    strict_1.default.equal(action.buildingKey, 'helioxExtractor');
});
(0, node_test_1.test)('prioritises an energy-deficit recommendation', () => {
    const action = (0, gamePresentation_1.selectPlanetNextAction)({
        activeConstruction: null,
        energyStatus: 'deficit',
        energyBlockedBuildingKeys: [],
        buildingLevels: {},
    });
    strict_1.default.equal(action.kind, 'energy');
    strict_1.default.equal(action.buildingKey, 'solarArray');
});
(0, node_test_1.test)('prioritises active construction above every other recommendation', () => {
    const action = (0, gamePresentation_1.selectPlanetNextAction)({
        activeConstruction: { buildingName: 'Solar Array', targetLevel: 2 },
        energyStatus: 'deficit',
        energyBlockedBuildingKeys: ['alloyMine'],
        buildingLevels: {},
    });
    strict_1.default.equal(action.kind, 'construction');
    strict_1.default.match(action.title, /Solar Array level 2/);
});
(0, node_test_1.test)('preserves supported planet sections and otherwise returns to overview', () => {
    strict_1.default.equal((0, gamePresentation_1.planetIdFromGamePath)('/game/planets/old/buildings'), 'old');
    strict_1.default.equal((0, gamePresentation_1.planetSwitchPath)('/game/planets/old/buildings', 'old', 'next'), '/game/planets/next/buildings');
    strict_1.default.equal((0, gamePresentation_1.planetSwitchPath)('/game/galaxy', 'old', 'next'), '/game/planets/next');
    strict_1.default.equal((0, gamePresentation_1.planetSwitchPath)('/game/planets/stale/buildings', 'old', 'next'), '/game/planets/next');
});

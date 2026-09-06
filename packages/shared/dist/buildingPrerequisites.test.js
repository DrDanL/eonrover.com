"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buildingPrerequisites_1 = require("./buildingPrerequisites");
(0, node_test_1.test)('allows buildings with no prerequisites', () => {
    strict_1.default.deepEqual((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('alloyMine', {}), {
        buildingId: 'alloyMine',
        requirements: [],
        unmetRequirements: [],
        meetsPrerequisites: true,
    });
});
(0, node_test_1.test)('reports one satisfied requirement', () => {
    const result = (0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('alloyStorage', { alloyMine: 3 });
    strict_1.default.equal(result?.meetsPrerequisites, true);
    strict_1.default.deepEqual(result?.requirements, [
        { buildingId: 'alloyMine', requiredLevel: 2, currentLevel: 3, met: true },
    ]);
    strict_1.default.deepEqual(result?.unmetRequirements, []);
});
(0, node_test_1.test)('reports one unmet requirement', () => {
    const result = (0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('helioxStorage', { helioxExtractor: 1 });
    strict_1.default.equal(result?.meetsPrerequisites, false);
    strict_1.default.deepEqual(result?.unmetRequirements, [
        { buildingId: 'helioxExtractor', requiredLevel: 2, currentLevel: 1, met: false },
    ]);
});
(0, node_test_1.test)('reports every requirement for a multi-requirement building', () => {
    const result = (0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('shipyard', {
        alloyMine: 2,
        helioxExtractor: 0,
        solarArray: 1,
    });
    strict_1.default.equal(result?.requirements.length, 3);
    strict_1.default.equal(result?.unmetRequirements.length, 2);
    strict_1.default.equal(result?.meetsPrerequisites, false);
});
(0, node_test_1.test)('preserves deterministic definition order', () => {
    const result = (0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('gateObservatory', {});
    strict_1.default.deepEqual(result?.requirements.map((requirement) => requirement.buildingId), [
        'researchLab',
        'aetherSynthesizer',
        'solarArray',
    ]);
    strict_1.default.deepEqual(result?.unmetRequirements.map((requirement) => requirement.buildingId), [
        'researchLab',
        'aetherSynthesizer',
        'solarArray',
    ]);
});
(0, node_test_1.test)('accepts a completed level exactly equal to the requirement', () => {
    strict_1.default.equal((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('aetherStorage', { aetherSynthesizer: 2 })?.meetsPrerequisites, true);
});
(0, node_test_1.test)('does not count a pending prerequisite target as completed', () => {
    const completedLevels = { alloyMine: 1 };
    const pendingUpgrade = { buildingId: 'alloyMine', targetLevel: 2 };
    strict_1.default.equal(pendingUpgrade.targetLevel, 2);
    strict_1.default.equal((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('alloyStorage', completedLevels)?.meetsPrerequisites, false);
});
(0, node_test_1.test)('rejects unknown building identifiers safely', () => {
    strict_1.default.equal((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('unknown-building', {}), null);
    strict_1.default.equal((0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('toString', {}), null);
});
(0, node_test_1.test)('keeps a legacy building locked for further upgrades when prerequisites are unmet', () => {
    const legacyCompletedLevels = { researchLab: 2, aetherSynthesizer: 0, solarArray: 1 };
    const result = (0, buildingPrerequisites_1.evaluateBuildingPrerequisites)('researchLab', legacyCompletedLevels);
    strict_1.default.equal(result?.buildingId, 'researchLab');
    strict_1.default.equal(result?.meetsPrerequisites, false);
    strict_1.default.deepEqual(result?.unmetRequirements, [
        { buildingId: 'aetherSynthesizer', requiredLevel: 1, currentLevel: 0, met: false },
        { buildingId: 'solarArray', requiredLevel: 2, currentLevel: 1, met: false },
    ]);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const researchCatalogue_1 = require("./researchCatalogue");
(0, node_test_1.default)('research catalogue contains every persisted id exactly once in deterministic category order', () => {
    strict_1.default.deepEqual(researchCatalogue_1.RESEARCH_CATALOGUE.map((entry) => entry.id), [
        'alloyProcessing', 'helioxCombustion', 'aetherPhysics', 'propulsionTheory', 'espionageTech', 'shieldTech', 'weaponTech', 'armourTech', 'gateTheory',
    ]);
    strict_1.default.equal(new Set(researchCatalogue_1.RESEARCH_CATALOGUE.map((entry) => entry.id)).size, researchCatalogue_1.RESEARCH_CATALOGUE.length);
    strict_1.default.equal(new Set(researchCatalogue_1.RESEARCH_CATALOGUE.map((entry) => entry.displayOrder)).size, researchCatalogue_1.RESEARCH_CATALOGUE.length);
    strict_1.default.deepEqual(researchCatalogue_1.RESEARCH_CATEGORIES.map((category) => category.id), ['economy', 'science', 'propulsion', 'intelligence', 'combat', 'gate']);
    strict_1.default.deepEqual(Object.keys(researchCatalogue_1.RESEARCH_BY_ID), researchCatalogue_1.RESEARCH_CATALOGUE.map((entry) => entry.id));
});
(0, node_test_1.default)('research costs and duration preserve the prototype formula with level, lab and speed inputs', () => {
    strict_1.default.deepEqual((0, researchCatalogue_1.researchCostForLevel)('alloyProcessing', 1), { alloy: 200, heliox: 100, aether: 0 });
    strict_1.default.deepEqual((0, researchCatalogue_1.researchCostForLevel)('alloyProcessing', 2), { alloy: 320, heliox: 160, aether: 0 });
    strict_1.default.equal((0, researchCatalogue_1.researchDurationForLevel)('alloyProcessing', 1, 0, 1), 1080);
    strict_1.default.equal((0, researchCatalogue_1.researchDurationForLevel)('alloyProcessing', 1, 2, 2), 180);
});
(0, node_test_1.default)('research evaluation uses account-wide completed levels and selected-planet lab requirements', () => {
    const evaluation = (0, researchCatalogue_1.evaluateResearchEntry)({
        id: 'gateTheory',
        currentLevel: 2,
        accountResearchLevels: { aetherPhysics: 3 },
        planetBuildingLevels: { researchLab: 5, gateObservatory: 0 },
        researchSpeed: 1,
    });
    strict_1.default.equal(evaluation.currentLevel, 2);
    strict_1.default.equal(evaluation.nextLevel, 3);
    strict_1.default.equal(evaluation.requirements[0].met, true);
    strict_1.default.equal(evaluation.requirements[1].met, false);
    strict_1.default.equal(evaluation.unmetRequirements.length, 1);
    strict_1.default.equal(evaluation.meetsRequirements, false);
});
(0, node_test_1.default)('research evaluation fails safely closed for invalid numbers and exposes every effect status', () => {
    const evaluation = (0, researchCatalogue_1.evaluateResearchEntry)({
        id: 'espionageTech', currentLevel: Number.NaN, accountResearchLevels: {}, planetBuildingLevels: { researchLab: Number.POSITIVE_INFINITY }, researchSpeed: Number.NaN,
    });
    strict_1.default.equal(evaluation.currentLevel, 0);
    strict_1.default.equal(evaluation.researchLabLevel, 0);
    strict_1.default.ok(Number.isFinite(evaluation.durationSeconds));
    strict_1.default.deepEqual(new Set(researchCatalogue_1.RESEARCH_CATALOGUE.map((entry) => entry.effect.status)), new Set(['ACTIVE', 'PARTIAL', 'PLANNED']));
});

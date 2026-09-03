"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const formulas_1 = require("./formulas");
(0, node_test_1.test)('scaledCost grows exponentially per level', () => {
    const l1 = (0, formulas_1.scaledCost)({ alloy: 60, heliox: 15, aether: 0 }, 1.5, 1);
    const l2 = (0, formulas_1.scaledCost)({ alloy: 60, heliox: 15, aether: 0 }, 1.5, 2);
    strict_1.default.equal(l1.alloy, 60);
    strict_1.default.equal(l2.alloy, 90);
});
(0, node_test_1.test)('buildingCost matches definitions', () => {
    const cost = (0, formulas_1.buildingCost)('alloyMine', 1);
    strict_1.default.equal(cost.alloy, 60);
    strict_1.default.equal(cost.heliox, 15);
});
(0, node_test_1.test)('accumulateProduction accrues and caps at storage capacity', () => {
    const gained = (0, formulas_1.accumulateProduction)(100, 3600, 3600, 5000);
    strict_1.default.equal(gained, 3700);
    const capped = (0, formulas_1.accumulateProduction)(4900, 3600, 3600, 5000);
    strict_1.default.equal(capped, 5000);
});
(0, node_test_1.test)('accumulateProduction is a no-op for non-positive elapsed time', () => {
    strict_1.default.equal((0, formulas_1.accumulateProduction)(100, 3600, 0, 5000), 100);
    strict_1.default.equal((0, formulas_1.accumulateProduction)(100, 3600, -10, 5000), 100);
});
(0, node_test_1.test)('distanceBetween scales by galaxy > system > slot', () => {
    const a = { galaxy: 1, system: 10, slot: 5 };
    const sameSystem = (0, formulas_1.distanceBetween)(a, { galaxy: 1, system: 10, slot: 8 });
    const otherSystem = (0, formulas_1.distanceBetween)(a, { galaxy: 1, system: 12, slot: 5 });
    const otherGalaxy = (0, formulas_1.distanceBetween)(a, { galaxy: 2, system: 10, slot: 5 });
    strict_1.default.ok(sameSystem < otherSystem);
    strict_1.default.ok(otherSystem < otherGalaxy);
});
(0, node_test_1.test)('flightDurationSeconds decreases as speed increases', () => {
    const slow = (0, formulas_1.flightDurationSeconds)(10000, 6000, 100, 1);
    const fast = (0, formulas_1.flightDurationSeconds)(10000, 12000, 100, 1);
    strict_1.default.ok(fast < slow);
});
(0, node_test_1.test)('espionageAccuracy is bounded between 0.1 and 1', () => {
    strict_1.default.equal((0, formulas_1.espionageAccuracy)(0, 0), 0.5);
    strict_1.default.ok((0, formulas_1.espionageAccuracy)(20, 0) <= 1);
    strict_1.default.ok((0, formulas_1.espionageAccuracy)(0, 20) >= 0.1);
});
(0, node_test_1.test)('resolveCombat: overwhelming attacker force destroys defender', () => {
    const attackers = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`,
        key: 'corvette',
        attack: 60,
        shield: 15,
        armour: 3500,
        hull: 3500,
        owner: 'attacker',
    }));
    const defenders = [
        { id: 'd0', key: 'flakTurret', attack: 40, shield: 10, armour: 2000, hull: 2000, owner: 'defender' },
    ];
    const result = (0, formulas_1.resolveCombat)(attackers, defenders, () => 0);
    strict_1.default.equal(result.outcome, 'attacker');
    strict_1.default.equal(result.survivorsDefender.length, 0);
    strict_1.default.ok(result.survivorsAttacker.length > 0);
});
(0, node_test_1.test)('resolveCombat: evenly matched single units can draw within round cap', () => {
    const attackers = [
        { id: 'a0', key: 'scout', attack: 1, shield: 1, armour: 400, hull: 400, owner: 'attacker' },
    ];
    const defenders = [
        { id: 'd0', key: 'flakTurret', attack: 1, shield: 1, armour: 2000, hull: 2000, owner: 'defender' },
    ];
    const result = (0, formulas_1.resolveCombat)(attackers, defenders, () => 0);
    strict_1.default.equal(result.outcome, 'draw');
    strict_1.default.equal(result.survivorsAttacker.length, 1);
    strict_1.default.equal(result.survivorsDefender.length, 1);
});

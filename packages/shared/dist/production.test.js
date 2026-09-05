"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const formulas_1 = require("./formulas");
const START = new Date('2026-01-01T00:00:00.000Z');
const HOUR_LATER = new Date('2026-01-01T01:00:00.000Z');
function productionInput(overrides = {}) {
    return {
        previousProductionAt: START,
        currentTime: HOUR_LATER,
        resources: { alloy: 100, heliox: 100, aether: 7 },
        buildingLevels: { alloyMine: 1, helioxExtractor: 1, aetherSynthesizer: 0 },
        environment: { type: 'temperate', temperature: 10, solarIndex: 0.7 },
        storage: { alloy: 10_000, heliox: 10_000, aether: 10_000 },
        energySupply: 100,
        energyDemand: 22,
        economySpeed: 1,
        productionModifier: 1,
        ...overrides,
    };
}
function assertClose(actual, expected, tolerance = 1e-10) {
    strict_1.default.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}
(0, node_test_1.test)('planet production awards nothing for zero elapsed time', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ currentTime: START }));
    strict_1.default.deepEqual(result.resources, { alloy: 100, heliox: 100, aether: 7 });
    strict_1.default.equal(result.elapsedSeconds, 0);
    strict_1.default.equal(result.lastProductionAt.getTime(), START.getTime());
});
(0, node_test_1.test)('planet production calculates one normal hour from existing balance', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput());
    strict_1.default.equal(result.resources.alloy, 133);
    strict_1.default.equal(result.resources.heliox, 122);
    strict_1.default.equal(result.resources.aether, 7);
    strict_1.default.equal(result.lastProductionAt.getTime(), HOUR_LATER.getTime());
});
(0, node_test_1.test)('planet production calculates multiple offline hours', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ currentTime: new Date('2026-01-01T03:00:00.000Z') }));
    assertClose(result.resources.alloy, 199);
    assertClose(result.resources.heliox, 166);
});
(0, node_test_1.test)('economy speed is applied exactly once', () => {
    const normal = (0, formulas_1.calculatePlanetProduction)(productionInput());
    const doubled = (0, formulas_1.calculatePlanetProduction)(productionInput({ economySpeed: 2 }));
    assertClose(doubled.resources.alloy - 100, (normal.resources.alloy - 100) * 2);
    assertClose(doubled.resources.heliox - 100, (normal.resources.heliox - 100) * 2);
});
(0, node_test_1.test)('full energy preserves production and an energy shortage reduces it proportionally', () => {
    const full = (0, formulas_1.calculatePlanetProduction)(productionInput({ energySupply: 22, energyDemand: 22 }));
    const reduced = (0, formulas_1.calculatePlanetProduction)(productionInput({ energySupply: 11, energyDemand: 22 }));
    strict_1.default.equal(full.energyEfficiency, 1);
    strict_1.default.equal(reduced.energyEfficiency, 0.5);
    assertClose(reduced.resources.alloy, 116.5);
    assertClose(reduced.resources.heliox, 111);
});
(0, node_test_1.test)('storage capacity bounds production', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ storage: { alloy: 120, heliox: 115, aether: 10_000 } }));
    strict_1.default.equal(result.resources.alloy, 120);
    strict_1.default.equal(result.resources.heliox, 115);
});
(0, node_test_1.test)('one capped resource does not stop another resource producing', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ storage: { alloy: 100, heliox: 10_000, aether: 10_000 } }));
    strict_1.default.equal(result.resources.alloy, 100);
    strict_1.default.equal(result.resources.heliox, 122);
});
(0, node_test_1.test)('a resource whose building has zero production remains unchanged', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ currentTime: new Date('2026-01-02T01:00:00.000Z') }));
    strict_1.default.equal(result.hourlyRates.aether, 0);
    strict_1.default.equal(result.resources.aether, 7);
});
(0, node_test_1.test)('a future stored timestamp produces nothing and is not moved', () => {
    const future = new Date('2026-01-01T02:00:00.000Z');
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ previousProductionAt: future }));
    strict_1.default.deepEqual(result.resources, { alloy: 100, heliox: 100, aether: 7 });
    strict_1.default.equal(result.elapsedSeconds, 0);
    strict_1.default.equal(result.lastProductionAt.getTime(), future.getTime());
});
(0, node_test_1.test)('a very long offline interval remains bounded by storage', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({
        currentTime: new Date('2036-01-01T00:00:00.000Z'),
        resources: { alloy: 0, heliox: 0, aether: 0 },
        buildingLevels: { alloyMine: 1, helioxExtractor: 1, aetherSynthesizer: 1 },
        storage: { alloy: 500, heliox: 400, aether: 300 },
        energySupply: 100,
        energyDemand: 40,
    }));
    strict_1.default.deepEqual(result.resources, { alloy: 500, heliox: 400, aether: 300 });
});
(0, node_test_1.test)('invalid numeric inputs cannot produce a persistable result', () => {
    strict_1.default.throws(() => (0, formulas_1.calculatePlanetProduction)(productionInput({ resources: { alloy: Number.NaN, heliox: 0, aether: 0 } })), /finite number/);
    strict_1.default.throws(() => (0, formulas_1.calculatePlanetProduction)(productionInput({ economySpeed: Number.POSITIVE_INFINITY })), /finite number/);
});
(0, node_test_1.test)('synchronisation clamps negative balances instead of preserving them', () => {
    const result = (0, formulas_1.calculatePlanetProduction)(productionInput({
        currentTime: START,
        resources: { alloy: -5, heliox: -1, aether: -10 },
    }));
    strict_1.default.deepEqual(result.resources, { alloy: 0, heliox: 0, aether: 0 });
});
(0, node_test_1.test)('twelve five-minute synchronisations equal one combined hour', () => {
    let resources = productionInput().resources;
    let previousProductionAt = START;
    for (let interval = 1; interval <= 12; interval += 1) {
        const currentTime = new Date(START.getTime() + interval * 5 * 60 * 1000);
        const result = (0, formulas_1.calculatePlanetProduction)(productionInput({ previousProductionAt, currentTime, resources }));
        resources = result.resources;
        previousProductionAt = result.lastProductionAt;
    }
    const combined = (0, formulas_1.calculatePlanetProduction)(productionInput());
    assertClose(resources.alloy, combined.resources.alloy);
    assertClose(resources.heliox, combined.resources.heliox);
    assertClose(resources.aether, combined.resources.aether);
});
(0, node_test_1.test)('fractional production is retained without refresh-frequency rounding', () => {
    const base = productionInput({
        resources: { alloy: 0, heliox: 0, aether: 0 },
        buildingLevels: { alloyMine: 3, helioxExtractor: 2, aetherSynthesizer: 1 },
        environment: { type: 'volcanic', temperature: 45, solarIndex: 0.9 },
        energySupply: 200,
        energyDemand: 72,
    });
    let resources = base.resources;
    let previousProductionAt = START;
    for (let minute = 1; minute <= 60; minute += 1) {
        const result = (0, formulas_1.calculatePlanetProduction)({
            ...base,
            previousProductionAt,
            currentTime: new Date(START.getTime() + minute * 60 * 1000),
            resources,
        });
        resources = result.resources;
        previousProductionAt = result.lastProductionAt;
    }
    const combined = (0, formulas_1.calculatePlanetProduction)(base);
    assertClose(resources.alloy, combined.resources.alloy, 1e-9);
    assertClose(resources.heliox, combined.resources.heliox, 1e-9);
    assertClose(resources.aether, combined.resources.aether, 1e-9);
    strict_1.default.notEqual(resources.aether, Math.round(resources.aether));
});

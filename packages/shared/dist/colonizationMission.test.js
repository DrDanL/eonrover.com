"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const index_1 = require("./index");
const origin = { galaxy: 3, system: 44, slot: 4 };
function validInput(overrides = {}) {
    return {
        origin,
        targetSlot: 9,
        ships: { colonyShip: 1 },
        fleetSpeed: 1,
        ...overrides,
    };
}
(0, node_test_1.default)('same-system colonization fixes speed and derives a finite plan', () => {
    const plan = (0, index_1.planSameSystemColonization)(validInput());
    strict_1.default.deepEqual(plan.target, { galaxy: origin.galaxy, system: origin.system, slot: 9 });
    strict_1.default.deepEqual(plan.ships, { colonyShip: 1 });
    strict_1.default.equal(plan.speedPercent, index_1.COLONIZATION_SPEED_PERCENT);
    strict_1.default.ok(Number.isInteger(plan.durationSeconds) && plan.durationSeconds > 0);
    strict_1.default.ok(Number.isInteger(plan.fuelHeliox) && plan.fuelHeliox >= 0);
});
(0, node_test_1.default)('same-system colonization rejects invalid slots and an origin-slot target', () => {
    for (const targetSlot of [0, -1, 1.5, Infinity, origin.slot, index_1.COLONIZATION_MAX_SLOT + 1]) {
        strict_1.default.throws(() => (0, index_1.planSameSystemColonization)(validInput({ targetSlot })));
    }
});
(0, node_test_1.default)('same-system colonization rejects malformed manifests, escorts, cargo, recall, and caller-selected speed', () => {
    for (const input of [
        validInput({ ships: {} }),
        validInput({ ships: { colonyShip: 2 } }),
        validInput({ ships: { colonyShip: 1, scout: 1 } }),
        validInput({ ships: { scout: 1 } }),
        validInput({ escorts: { scout: 1 } }),
        validInput({ cargo: { alloy: 1 } }),
        validInput({ recall: true }),
        validInput({ speedPercent: 100 }),
        validInput({ targetGalaxy: 999, targetSystem: 999 }),
    ]) {
        strict_1.default.throws(() => (0, index_1.planSameSystemColonization)(input));
    }
});
(0, node_test_1.default)('colony characteristics are deterministic and stay in the selected profile ranges', () => {
    const missionId = '0db6897f-4206-4ae1-b685-8d34e7f6b4ee';
    const first = (0, index_1.deriveColonyCharacteristics)(missionId);
    const second = (0, index_1.deriveColonyCharacteristics)(missionId);
    strict_1.default.deepEqual(second, first);
    const profile = index_1.PLANET_TYPES[first.planetType];
    strict_1.default.ok(Number.isInteger(first.temperature));
    strict_1.default.ok(first.temperature >= profile.temperatureRange[0] && first.temperature <= profile.temperatureRange[1]);
    strict_1.default.ok(Number.isFinite(first.solarIndex));
    strict_1.default.ok(first.solarIndex >= profile.solarIndexRange[0] && first.solarIndex <= profile.solarIndexRange[1]);
    strict_1.default.equal(first.fieldCapacity, 180);
});
(0, node_test_1.default)('colony starter state is explicit and exact', () => {
    strict_1.default.deepEqual(index_1.COLONY_STARTER_STATE, {
        fieldCapacity: 180,
        resources: { alloy: 500, heliox: 300, aether: 0 },
        buildings: { solarArray: 1, alloyMine: 0, helioxExtractor: 0 },
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
const espionageProbeMission_1 = require("./espionageProbeMission");
const origin = { galaxy: 2, system: 40, slot: 4 };
const adjacentTarget = { galaxy: 2, system: 40, slot: 5 };
const distantTarget = { galaxy: 2, system: 400, slot: 12 };
function plan(overrides = {}) {
    return (0, espionageProbeMission_1.planEspionageProbeMission)({ origin, target: adjacentTarget, fleetSpeed: 1, ...overrides });
}
function expectCode(code, action) {
    strict_1.default.throws(action, (error) => error instanceof espionageProbeMission_1.EspionageProbePlanError && error.code === code);
}
(0, node_test_1.default)('plans an adjacent same-galaxy Probe journey with canonical fixed values', () => {
    const distance = (0, formulas_1.distanceBetween)(origin, adjacentTarget);
    const duration = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.probe.speed, espionageProbeMission_1.ESPIONAGE_PROBE_SPEED_PERCENT, 1);
    const fuel = (0, formulas_1.fuelConsumption)({ probe: 1 }, distance, duration);
    strict_1.default.deepEqual(plan(), {
        ships: { probe: 1 },
        speedPercent: 100,
        outboundDurationSeconds: duration,
        returnDurationSeconds: duration,
        outboundFuelHeliox: fuel,
        returnFuelHeliox: fuel,
        timing: { arrivalAfterDepartureSeconds: duration, returnAfterArrivalSeconds: duration },
    });
});
(0, node_test_1.default)('uses the existing travel rules for a distant same-galaxy target', () => {
    const result = plan({ target: distantTarget, fleetSpeed: 2 });
    const distance = (0, formulas_1.distanceBetween)(origin, distantTarget);
    const expectedDuration = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.probe.speed, espionageProbeMission_1.ESPIONAGE_PROBE_SPEED_PERCENT, 2);
    const expectedFuel = (0, formulas_1.fuelConsumption)({ probe: 1 }, distance, expectedDuration);
    strict_1.default.equal(result.outboundDurationSeconds, expectedDuration);
    strict_1.default.equal(result.outboundFuelHeliox, expectedFuel);
    strict_1.default.ok(Number.isInteger(result.outboundDurationSeconds) && result.outboundDurationSeconds > 0);
    strict_1.default.ok(Number.isSafeInteger(result.outboundFuelHeliox) && result.outboundFuelHeliox >= 0);
    strict_1.default.equal(result.returnDurationSeconds, result.outboundDurationSeconds);
    strict_1.default.equal(result.returnFuelHeliox, result.outboundFuelHeliox);
});
(0, node_test_1.default)('rejects coordinates outside shared Galaxy bounds and malformed coordinate values', () => {
    for (const invalid of [
        { galaxy: 0, system: 1, slot: 1 },
        { galaxy: 7, system: 1, slot: 1 },
        { galaxy: 1, system: 0, slot: 1 },
        { galaxy: 1, system: 401, slot: 1 },
        { galaxy: 1, system: 1, slot: 0 },
        { galaxy: 1, system: 1, slot: 13 },
        { galaxy: 1.5, system: 1, slot: 1 },
        { galaxy: 1, system: Number.POSITIVE_INFINITY, slot: 1 },
        { galaxy: '1', system: 1, slot: 1 },
        { galaxy: 1, system: 1, slot: 1, planetId: 'not-allowed' },
    ]) {
        expectCode('INVALID_COORDINATES', () => plan({ target: invalid }));
    }
});
(0, node_test_1.default)('rejects same-coordinate and cross-galaxy probe targets', () => {
    expectCode('IDENTICAL_COORDINATES', () => plan({ target: origin }));
    expectCode('CROSS_GALAXY_TARGET', () => plan({ target: { galaxy: 3, system: 40, slot: 5 } }));
});
(0, node_test_1.default)('rejects every caller-controlled mission field so it cannot affect the canonical plan', () => {
    for (const injection of [
        { ships: { probe: 10 } },
        { manifest: { probe: 1 } },
        { cargo: { alloy: 1 } },
        { speedPercent: 10 },
        { durationSeconds: 1 },
        { fuelHeliox: 0 },
        { reportAccuracy: 1 },
        { targetPlanetId: 'untrusted-target' },
    ]) {
        expectCode('INVALID_INPUT', () => plan(injection));
    }
    expectCode('INVALID_FLEET_SPEED', () => plan({ fleetSpeed: 0 }));
});

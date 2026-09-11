"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
const transportMission_1 = require("./transportMission");
const origin = { galaxy: 1, system: 10, slot: 3 };
const destination = { galaxy: 1, system: 14, slot: 8 };
const cargo = { alloy: 1250, heliox: 700, aether: 50 };
function plan(overrides = {}) {
    return (0, transportMission_1.planTransportMission)({ origin, destination, quantity: 2, cargo, fleetSpeed: 1, ...overrides });
}
function expectCode(code, action) {
    strict_1.default.throws(action, (error) => error instanceof transportMission_1.TransportPlanError && error.code === code);
}
(0, node_test_1.default)('plans a canonical fixed-speed Transporter round trip from known coordinates', () => {
    const distance = (0, formulas_1.distanceBetween)(origin, destination);
    const duration = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.transporter.speed, transportMission_1.TRANSPORT_SPEED_PERCENT, 1);
    const fuel = (0, formulas_1.fuelConsumption)({ transporter: 2 }, distance, duration);
    strict_1.default.deepEqual(plan(), {
        ships: { transporter: 2 },
        speedPercent: 100,
        cargo,
        cargoCapacity: constants_1.SHIPS.transporter.cargo * 2,
        usedCargoCapacity: 2000,
        remainingCargoCapacity: constants_1.SHIPS.transporter.cargo * 2 - 2000,
        outboundDurationSeconds: duration,
        returnDurationSeconds: duration,
        outboundFuelHeliox: fuel,
        returnFuelHeliox: fuel,
        totalReservedFuelHeliox: fuel * 2,
        timing: { arrivalAfterDepartureSeconds: duration, returnAfterArrivalSeconds: duration },
    });
});
(0, node_test_1.default)('uses one canonical Transporter manifest and fixed 100 percent speed', () => {
    const result = plan({ quantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } });
    strict_1.default.deepEqual(result.ships, { transporter: 1 });
    strict_1.default.equal(result.speedPercent, transportMission_1.TRANSPORT_SPEED_PERCENT);
    expectCode('INVALID_INPUT', () => plan({ speedPercent: 10 }));
    expectCode('INVALID_INPUT', () => plan({ ships: { scout: 1 } }));
    expectCode('INVALID_INPUT', () => plan({ returnPolicy: 'manual' }));
});
(0, node_test_1.default)('enforces single and multiple Transporter cargo capacity', () => {
    strict_1.default.equal(plan({ quantity: 1, cargo: { alloy: 4000, heliox: 0, aether: 0 } }).cargoCapacity, 4000);
    strict_1.default.equal(plan({ quantity: 2, cargo: { alloy: 8000, heliox: 0, aether: 0 } }).remainingCargoCapacity, 0);
    expectCode('CARGO_CAPACITY_EXCEEDED', () => plan({ quantity: 1, cargo: { alloy: 4001, heliox: 0, aether: 0 } }));
});
(0, node_test_1.default)('counts Heliox as cargo while keeping round-trip fuel separate', () => {
    const result = plan({ quantity: 1, cargo: { alloy: 0, heliox: 4000, aether: 0 } });
    strict_1.default.equal(result.usedCargoCapacity, 4000);
    strict_1.default.equal(result.remainingCargoCapacity, 0);
    strict_1.default.ok(result.outboundFuelHeliox > 0);
    strict_1.default.equal(result.totalReservedFuelHeliox, result.outboundFuelHeliox + result.returnFuelHeliox);
});
(0, node_test_1.default)('rejects invalid cargo values and shapes without coercion', () => {
    for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: value, heliox: 0, aether: 1 } }));
    }
    expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: 1, heliox: 0 } }));
    expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: 1, heliox: 0, aether: 0, darkMatter: 1 } }));
    expectCode('INVALID_CARGO', () => plan({ cargo: [] }));
});
(0, node_test_1.default)('rejects empty cargo and invalid Transporter quantities', () => {
    expectCode('EMPTY_CARGO', () => plan({ cargo: { alloy: 0, heliox: 0, aether: 0 } }));
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, transportMission_1.MAX_TRANSPORTER_QUANTITY + 1]) {
        expectCode('INVALID_QUANTITY', () => plan({ quantity }));
    }
});
(0, node_test_1.default)('rejects identical or invalid coordinates', () => {
    expectCode('IDENTICAL_COORDINATES', () => plan({ destination: origin }));
    expectCode('INVALID_COORDINATES', () => plan({ origin: { galaxy: 0, system: 1, slot: 1 } }));
    expectCode('INVALID_COORDINATES', () => plan({ destination: { galaxy: 1, system: 1.5, slot: 1 } }));
    expectCode('INVALID_COORDINATES', () => plan({ destination: { galaxy: 1, system: 1, slot: Number.POSITIVE_INFINITY } }));
});
(0, node_test_1.default)('returns finite positive travel durations and finite round-trip fuel', () => {
    const result = plan({ fleetSpeed: 3 });
    strict_1.default.ok(Number.isInteger(result.outboundDurationSeconds) && result.outboundDurationSeconds > 0);
    strict_1.default.ok(Number.isInteger(result.returnDurationSeconds) && result.returnDurationSeconds > 0);
    strict_1.default.ok(Number.isSafeInteger(result.outboundFuelHeliox) && result.outboundFuelHeliox >= 0);
    strict_1.default.ok(Number.isSafeInteger(result.totalReservedFuelHeliox) && result.totalReservedFuelHeliox >= 0);
    expectCode('INVALID_FLEET_SPEED', () => plan({ fleetSpeed: 0 }));
});

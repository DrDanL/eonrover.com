"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspionageProbePlanError = exports.ESPIONAGE_PROBE_SPEED_PERCENT = void 0;
exports.planEspionageProbeMission = planEspionageProbeMission;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
/** Espionage Probe travel is deliberately fixed; disclosure rules come later. */
exports.ESPIONAGE_PROBE_SPEED_PERCENT = 100;
/** Stable validation error for later service-layer error mapping. */
class EspionageProbePlanError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'EspionageProbePlanError';
    }
}
exports.EspionageProbePlanError = EspionageProbePlanError;
function fail(code, message) {
    throw new EspionageProbePlanError(code, message);
}
function coordinate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail('INVALID_COORDINATES', 'Probe origin and target coordinates must be bounded integers.');
    }
    const candidate = value;
    const keys = Object.keys(candidate).sort();
    const expected = ['galaxy', 'slot', 'system'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        return fail('INVALID_COORDINATES', 'Probe origin and target coordinates must contain exactly galaxy, system, and slot.');
    }
    const { galaxy, system, slot } = candidate;
    if (typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
        || typeof system !== 'number' || !Number.isSafeInteger(system)
        || typeof slot !== 'number' || !Number.isSafeInteger(slot)
        || galaxy < constants_1.GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > constants_1.GALAXY_COORDINATE_BOUNDS.galaxy.max
        || system < constants_1.GALAXY_COORDINATE_BOUNDS.system.min || system > constants_1.GALAXY_COORDINATE_BOUNDS.system.max
        || slot < constants_1.GALAXY_COORDINATE_BOUNDS.slot.min || slot > constants_1.GALAXY_COORDINATE_BOUNDS.slot.max) {
        return fail('INVALID_COORDINATES', 'Probe origin and target coordinates are outside the canonical Galaxy bounds.');
    }
    return { galaxy, system, slot };
}
/**
 * Plans the future intelligence-only Probe journey from server-resolved
 * coordinates. It accepts neither caller-selected ships, cargo, speed, timing,
 * report accuracy, nor a target identity.
 */
function planEspionageProbeMission(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return fail('INVALID_INPUT', 'Probe planning input is invalid.');
    }
    const candidate = input;
    const keys = Object.keys(candidate).sort();
    const allowedKeys = ['fleetSpeed', 'origin', 'target'];
    if (keys.length !== allowedKeys.length || keys.some((key, index) => key !== allowedKeys[index])) {
        return fail('INVALID_INPUT', 'Probe planning accepts only origin, target, and trusted fleet speed.');
    }
    const values = candidate;
    const origin = coordinate(values.origin);
    const target = coordinate(values.target);
    if (origin.galaxy !== target.galaxy) {
        return fail('CROSS_GALAXY_TARGET', 'Probe targets must be in the same galaxy as their origin.');
    }
    if (origin.system === target.system && origin.slot === target.slot) {
        return fail('IDENTICAL_COORDINATES', 'Probe origin and target coordinates must be distinct.');
    }
    if (typeof values.fleetSpeed !== 'number' || !Number.isFinite(values.fleetSpeed) || values.fleetSpeed <= 0) {
        return fail('INVALID_FLEET_SPEED', 'Probe fleet speed must be finite and positive.');
    }
    const ships = { probe: 1 };
    const distance = (0, formulas_1.distanceBetween)(origin, target);
    const outboundDurationSeconds = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.probe.speed, exports.ESPIONAGE_PROBE_SPEED_PERCENT, values.fleetSpeed);
    const outboundFuelHeliox = (0, formulas_1.fuelConsumption)(ships, distance, outboundDurationSeconds);
    const returnDurationSeconds = outboundDurationSeconds;
    const returnFuelHeliox = outboundFuelHeliox;
    if (!Number.isInteger(outboundDurationSeconds) || outboundDurationSeconds <= 0
        || !Number.isSafeInteger(outboundFuelHeliox) || outboundFuelHeliox < 0
        || !Number.isInteger(returnDurationSeconds) || returnDurationSeconds <= 0
        || !Number.isSafeInteger(returnFuelHeliox) || returnFuelHeliox < 0) {
        return fail('INVALID_CALCULATION', 'Probe planning produced invalid travel values.');
    }
    return {
        ships,
        speedPercent: exports.ESPIONAGE_PROBE_SPEED_PERCENT,
        outboundDurationSeconds,
        returnDurationSeconds,
        outboundFuelHeliox,
        returnFuelHeliox,
        timing: {
            arrivalAfterDepartureSeconds: outboundDurationSeconds,
            returnAfterArrivalSeconds: returnDurationSeconds,
        },
    };
}

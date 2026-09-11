"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransportPlanError = exports.MAX_TRANSPORTER_QUANTITY = exports.MIN_TRANSPORTER_QUANTITY = exports.TRANSPORT_SPEED_PERCENT = void 0;
exports.planTransportMission = planTransportMission;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
exports.TRANSPORT_SPEED_PERCENT = 100;
exports.MIN_TRANSPORTER_QUANTITY = 1;
exports.MAX_TRANSPORTER_QUANTITY = 100;
/** A stable error for callers that need to map invalid transport commands. */
class TransportPlanError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TransportPlanError';
    }
}
exports.TransportPlanError = TransportPlanError;
const CARGO_KEYS = ['aether', 'alloy', 'heliox'];
function fail(code, message) {
    throw new TransportPlanError(code, message);
}
function positiveSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function nonNegativeSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function canonicalCoordinates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail('INVALID_COORDINATES', 'Transport origin and destination coordinates must be valid positive integers.');
    }
    const candidate = value;
    if (!positiveSafeInteger(candidate.galaxy) || !positiveSafeInteger(candidate.system) || !positiveSafeInteger(candidate.slot)) {
        return fail('INVALID_COORDINATES', 'Transport origin and destination coordinates must be valid positive integers.');
    }
    return { galaxy: candidate.galaxy, system: candidate.system, slot: candidate.slot };
}
function canonicalCargo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail('INVALID_CARGO', 'Transport cargo must contain exactly Alloy, Heliox, and Aether safe-integer amounts.');
    }
    const candidate = value;
    const keys = Object.keys(candidate).sort();
    if (keys.length !== CARGO_KEYS.length || keys.some((key, index) => key !== CARGO_KEYS[index])) {
        return fail('INVALID_CARGO', 'Transport cargo must contain exactly Alloy, Heliox, and Aether safe-integer amounts.');
    }
    if (!nonNegativeSafeInteger(candidate.alloy) || !nonNegativeSafeInteger(candidate.heliox) || !nonNegativeSafeInteger(candidate.aether)) {
        return fail('INVALID_CARGO', 'Transport cargo amounts must be finite non-negative safe integers.');
    }
    const cargo = { alloy: candidate.alloy, heliox: candidate.heliox, aether: candidate.aether };
    if (cargo.alloy + cargo.heliox + cargo.aether === 0) {
        return fail('EMPTY_CARGO', 'Transport cargo must contain at least one resource.');
    }
    return cargo;
}
/**
 * Plans the deliberately narrow first transport journey. It validates only
 * caller-independent command shape; ownership, stock, fuel reservation, and
 * destination storage remain transaction concerns for later stages.
 */
function planTransportMission(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return fail('INVALID_INPUT', 'Transport input is invalid.');
    }
    const candidate = input;
    const allowedKeys = ['cargo', 'destination', 'fleetSpeed', 'origin', 'quantity'];
    const actualKeys = Object.keys(candidate).sort();
    if (actualKeys.length !== allowedKeys.length || actualKeys.some((key, index) => key !== allowedKeys[index])) {
        return fail('INVALID_INPUT', 'Transport accepts only origin, destination, quantity, cargo, and fleet speed.');
    }
    const values = candidate;
    const origin = canonicalCoordinates(values.origin);
    const destination = canonicalCoordinates(values.destination);
    if (origin.galaxy === destination.galaxy && origin.system === destination.system && origin.slot === destination.slot) {
        return fail('IDENTICAL_COORDINATES', 'Transport origin and destination must be distinct.');
    }
    if (!positiveSafeInteger(values.quantity) || values.quantity < exports.MIN_TRANSPORTER_QUANTITY || values.quantity > exports.MAX_TRANSPORTER_QUANTITY) {
        return fail('INVALID_QUANTITY', `Transporter quantity must be an integer from ${exports.MIN_TRANSPORTER_QUANTITY} through ${exports.MAX_TRANSPORTER_QUANTITY}.`);
    }
    if (typeof values.fleetSpeed !== 'number' || !Number.isFinite(values.fleetSpeed) || values.fleetSpeed <= 0) {
        return fail('INVALID_FLEET_SPEED', 'Transport fleet speed must be finite and positive.');
    }
    const cargo = canonicalCargo(values.cargo);
    const ships = { transporter: values.quantity };
    const cargoCapacity = constants_1.SHIPS.transporter.cargo * values.quantity;
    const usedCargoCapacity = cargo.alloy + cargo.heliox + cargo.aether;
    if (usedCargoCapacity > cargoCapacity) {
        return fail('CARGO_CAPACITY_EXCEEDED', 'Transport cargo exceeds the selected Transporter capacity.');
    }
    const distance = (0, formulas_1.distanceBetween)(origin, destination);
    const outboundDurationSeconds = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.transporter.speed, exports.TRANSPORT_SPEED_PERCENT, values.fleetSpeed);
    const outboundFuelHeliox = (0, formulas_1.fuelConsumption)(ships, distance, outboundDurationSeconds);
    const returnDurationSeconds = outboundDurationSeconds;
    const returnFuelHeliox = outboundFuelHeliox;
    const totalReservedFuelHeliox = outboundFuelHeliox + returnFuelHeliox;
    if (!Number.isSafeInteger(cargoCapacity)
        || !Number.isSafeInteger(usedCargoCapacity)
        || !Number.isInteger(outboundDurationSeconds)
        || outboundDurationSeconds <= 0
        || !Number.isSafeInteger(outboundFuelHeliox)
        || outboundFuelHeliox < 0
        || !Number.isSafeInteger(totalReservedFuelHeliox)) {
        return fail('INVALID_CALCULATION', 'Transport planning produced invalid travel values.');
    }
    return {
        ships,
        speedPercent: exports.TRANSPORT_SPEED_PERCENT,
        cargo,
        cargoCapacity,
        usedCargoCapacity,
        remainingCargoCapacity: cargoCapacity - usedCargoCapacity,
        outboundDurationSeconds,
        returnDurationSeconds,
        outboundFuelHeliox,
        returnFuelHeliox,
        totalReservedFuelHeliox,
        timing: {
            arrivalAfterDepartureSeconds: outboundDurationSeconds,
            returnAfterArrivalSeconds: returnDurationSeconds,
        },
    };
}

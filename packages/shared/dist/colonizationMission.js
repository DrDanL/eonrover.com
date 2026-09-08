"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLONIZATION_MAX_SLOT = exports.COLONIZATION_MIN_SLOT = exports.COLONIZATION_SPEED_PERCENT = void 0;
exports.planSameSystemColonization = planSameSystemColonization;
exports.deriveColonyCharacteristics = deriveColonyCharacteristics;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
exports.COLONIZATION_SPEED_PERCENT = 100;
exports.COLONIZATION_MIN_SLOT = 1;
exports.COLONIZATION_MAX_SLOT = 12;
function finitePositiveInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
function assertOrigin(origin) {
    if (!origin || !finitePositiveInteger(origin.galaxy) || !finitePositiveInteger(origin.system) || !finitePositiveInteger(origin.slot)) {
        throw new Error('Colonization origin coordinates are invalid.');
    }
}
function canonicalColonyShip(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Colonization requires exactly one Colony Ship.');
    }
    const entries = Object.entries(input);
    if (entries.length !== 1 || entries[0][0] !== 'colonyShip' || entries[0][1] !== 1) {
        throw new Error('Colonization requires exactly one Colony Ship and no escorts.');
    }
    return { colonyShip: 1 };
}
/**
 * Plans only the bounded, same-system colony mission. The caller can select
 * neither speed nor cargo; all values returned here are derived from server
 * coordinates, the fixed Colony Ship definition, and the configured fleet
 * speed.
 */
function planSameSystemColonization(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Colonization input is invalid.');
    }
    const allowedKeys = new Set(['origin', 'targetSlot', 'ships', 'fleetSpeed']);
    if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
        throw new Error('Colonization does not permit caller-selected coordinates, cargo, escorts, recall, or speed.');
    }
    if (input.cargo !== undefined
        || input.escorts !== undefined
        || input.recall !== undefined
        || input.speedPercent !== undefined) {
        throw new Error('Colonization does not permit cargo, escorts, recall, or caller-selected speed.');
    }
    assertOrigin(input.origin);
    if (!finitePositiveInteger(input.targetSlot)
        || input.targetSlot < exports.COLONIZATION_MIN_SLOT
        || input.targetSlot > exports.COLONIZATION_MAX_SLOT
        || input.targetSlot === input.origin.slot) {
        throw new Error('Colonization target slot must be an empty slot from 1 through 12 in the origin system.');
    }
    if (typeof input.fleetSpeed !== 'number' || !Number.isFinite(input.fleetSpeed) || input.fleetSpeed <= 0) {
        throw new Error('Colonization fleet speed is invalid.');
    }
    const ships = canonicalColonyShip(input.ships);
    const target = { galaxy: input.origin.galaxy, system: input.origin.system, slot: input.targetSlot };
    const distance = (0, formulas_1.distanceBetween)(input.origin, target);
    const durationSeconds = (0, formulas_1.flightDurationSeconds)(distance, constants_1.SHIPS.colonyShip.speed, exports.COLONIZATION_SPEED_PERCENT, input.fleetSpeed);
    const fuelHeliox = (0, formulas_1.fuelConsumption)(ships, distance, durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(fuelHeliox) || fuelHeliox < 0) {
        throw new Error('Colonization calculation is invalid.');
    }
    return { target, ships, speedPercent: exports.COLONIZATION_SPEED_PERCENT, durationSeconds, fuelHeliox };
}
function hash32(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
function unitInterval(seed) {
    return hash32(seed) / 0xffffffff;
}
/**
 * Derives a stable, server-persistable environmental profile from the mission
 * identifier. Completion consumes the accepted snapshot and never randomises
 * an arriving colony.
 */
function deriveColonyCharacteristics(missionId) {
    if (typeof missionId !== 'string' || !missionId.trim()) {
        throw new Error('Colonization mission id is invalid.');
    }
    const keys = Object.keys(constants_1.PLANET_TYPES).sort();
    const planetType = keys[hash32(`${missionId}:type`) % keys.length];
    const profile = constants_1.PLANET_TYPES[planetType];
    const [temperatureMin, temperatureMax] = profile.temperatureRange;
    const [solarMin, solarMax] = profile.solarIndexRange;
    const temperature = Math.round(temperatureMin + unitInterval(`${missionId}:temperature`) * (temperatureMax - temperatureMin));
    const solarIndex = Number((solarMin + unitInterval(`${missionId}:solar`) * (solarMax - solarMin)).toFixed(6));
    if (!Number.isInteger(temperature) || !Number.isFinite(solarIndex) || solarIndex < solarMin || solarIndex > solarMax) {
        throw new Error('Colonization characteristics are invalid.');
    }
    return { planetType, temperature, solarIndex, fieldCapacity: constants_1.COLONY_STARTER_STATE.fieldCapacity };
}

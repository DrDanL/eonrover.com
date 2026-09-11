"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspionageDisclosureError = exports.ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS = void 0;
exports.espionageDisclosureTierForAccuracy = espionageDisclosureTierForAccuracy;
exports.discloseEspionageTarget = discloseEspionageTarget;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
/**
 * `espionageAccuracy` is bounded to 0.1 through 1.0. These thresholds divide
 * that score into deterministic, named disclosure tiers without changing the
 * underlying research formula or any balance value.
 */
exports.ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS = Object.freeze({
    RESOURCES: 0.4,
    BUILDINGS: 0.6,
    FORCES: 0.8,
});
class EspionageDisclosureError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'EspionageDisclosureError';
    }
}
exports.EspionageDisclosureError = EspionageDisclosureError;
function fail(code, message) {
    throw new EspionageDisclosureError(code, message);
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonicalNonNegativeNumber(value, code, description) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fail(code, `${description} must be a finite non-negative number.`);
    }
    return Object.is(value, -0) ? 0 : value;
}
function canonicalNonNegativeSafeInteger(value, description) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return fail('INVALID_TARGET_SNAPSHOT', `${description} must be a finite non-negative safe integer.`);
    }
    return Object.is(value, -0) ? 0 : value;
}
function canonicalCoordinates(value) {
    if (!isRecord(value))
        return fail('INVALID_TARGET_SNAPSHOT', 'Target coordinates are required.');
    const { galaxy, system, slot } = value;
    if (typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
        || typeof system !== 'number' || !Number.isSafeInteger(system)
        || typeof slot !== 'number' || !Number.isSafeInteger(slot)
        || galaxy < constants_1.GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > constants_1.GALAXY_COORDINATE_BOUNDS.galaxy.max
        || system < constants_1.GALAXY_COORDINATE_BOUNDS.system.min || system > constants_1.GALAXY_COORDINATE_BOUNDS.system.max
        || slot < constants_1.GALAXY_COORDINATE_BOUNDS.slot.min || slot > constants_1.GALAXY_COORDINATE_BOUNDS.slot.max) {
        return fail('INVALID_TARGET_SNAPSHOT', 'Target coordinates must satisfy the canonical Galaxy bounds.');
    }
    return { galaxy, system, slot };
}
function canonicalIdentity(value) {
    if (!isRecord(value))
        return fail('INVALID_TARGET_SNAPSHOT', 'Target public identity is required.');
    const { coordinates, planetName, planetType, ownerUsername } = value;
    if (typeof planetName !== 'string' || planetName.length === 0
        || typeof ownerUsername !== 'string' || ownerUsername.length === 0
        || typeof planetType !== 'string' || !(planetType in constants_1.PLANET_TYPES)) {
        return fail('INVALID_TARGET_SNAPSHOT', 'Target public identity is invalid.');
    }
    return {
        coordinates: canonicalCoordinates(coordinates),
        planetName,
        planetType: planetType,
        ownerUsername,
    };
}
function canonicalResources(value) {
    if (!isRecord(value))
        return fail('INVALID_TARGET_SNAPSHOT', 'Target resources are required.');
    return {
        alloy: canonicalNonNegativeNumber(value.alloy, 'INVALID_TARGET_SNAPSHOT', 'Target Alloy'),
        heliox: canonicalNonNegativeNumber(value.heliox, 'INVALID_TARGET_SNAPSHOT', 'Target Heliox'),
        aether: canonicalNonNegativeNumber(value.aether, 'INVALID_TARGET_SNAPSHOT', 'Target Aether'),
    };
}
function canonicalCompletedBuildings(value) {
    if (!isRecord(value))
        return fail('INVALID_TARGET_SNAPSHOT', 'Target completed buildings are required.');
    const buildings = {};
    for (const key of Object.keys(constants_1.BUILDINGS).sort()) {
        if (value[key] === undefined)
            continue;
        const level = canonicalNonNegativeSafeInteger(value[key], `Target completed building ${key}`);
        if (level > 0)
            buildings[key] = level;
    }
    return buildings;
}
function canonicalQuantities(value, definitions, description) {
    if (!isRecord(value))
        return fail('INVALID_TARGET_SNAPSHOT', `Target ${description} are required.`);
    const quantities = {};
    for (const key of Object.keys(definitions).sort()) {
        if (value[key] === undefined)
            continue;
        const quantity = canonicalNonNegativeSafeInteger(value[key], `Target ${description} ${key}`);
        if (quantity > 0)
            quantities[key] = quantity;
    }
    return quantities;
}
function canonicalTarget(value) {
    if (!isRecord(value))
        return fail('INVALID_INPUT', 'Espionage disclosure requires a settled target snapshot.');
    return {
        publicIdentity: canonicalIdentity(value.publicIdentity),
        resources: canonicalResources(value.resources),
        completedBuildings: canonicalCompletedBuildings(value.completedBuildings),
        ships: canonicalQuantities(value.ships, constants_1.SHIPS, 'ships'),
        defences: canonicalQuantities(value.defences, constants_1.DEFENCES, 'defences'),
    };
}
/** Maps an already calculated accuracy score to a public disclosure tier. */
function espionageDisclosureTierForAccuracy(accuracy) {
    if (!Number.isFinite(accuracy) || accuracy < 0.1 || accuracy > 1) {
        return fail('INVALID_ACCURACY', 'Espionage accuracy must be within the formula range of 0.1 through 1.');
    }
    if (accuracy >= exports.ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.FORCES)
        return 'FORCES';
    if (accuracy >= exports.ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.BUILDINGS)
        return 'BUILDINGS';
    if (accuracy >= exports.ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.RESOURCES)
        return 'RESOURCES';
    return 'IDENTITY';
}
/**
 * Projects a deterministic, privacy-safe report from an already-authoritative
 * snapshot. The policy builds every tier from explicit allowlists and never
 * serialises arbitrary input data.
 */
function discloseEspionageTarget(input) {
    if (!isRecord(input))
        return fail('INVALID_INPUT', 'Espionage disclosure input is invalid.');
    const attackerLevel = canonicalNonNegativeNumber(input.attackerEspionageTechnology, 'INVALID_TECHNOLOGY_LEVEL', 'Attacker Espionage Technology level');
    const defenderLevel = canonicalNonNegativeNumber(input.defenderEspionageTechnology, 'INVALID_TECHNOLOGY_LEVEL', 'Defender Espionage Technology level');
    const target = canonicalTarget(input.target);
    const tier = espionageDisclosureTierForAccuracy((0, formulas_1.espionageAccuracy)(attackerLevel, defenderLevel));
    const report = { target: target.publicIdentity, tier };
    if (tier === 'IDENTITY')
        return report;
    report.resources = target.resources;
    if (tier === 'RESOURCES')
        return report;
    report.buildings = target.completedBuildings;
    if (tier === 'BUILDINGS')
        return report;
    report.ships = target.ships;
    report.defences = target.defences;
    return report;
}

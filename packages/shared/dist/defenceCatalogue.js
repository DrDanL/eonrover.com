"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_SHIPYARD_DEFENCE_KEYS = exports.DEFENCE_BY_ID = exports.DEFENCE_CATALOGUE = void 0;
exports.isActiveShipyardDefenceKey = isActiveShipyardDefenceKey;
exports.evaluateDefenceCatalogue = evaluateDefenceCatalogue;
const constants_1 = require("./constants");
/**
 * The defence catalogue is deliberately separate from ships.  It provides the
 * sole allowlisted source for a future defence presentation and construction
 * command. Shipyard activation stays deliberately allowlisted.
 */
exports.DEFENCE_CATALOGUE = [
    { id: 'flakTurret', displayOrder: 10, availability: 'ACTIVE', availabilityMessage: 'Available for Shipyard construction.' },
    { id: 'railBattery', displayOrder: 20, availability: 'ACTIVE', availabilityMessage: 'Available with Shipyard level 4 and Weapon Technology level 2.' },
    { id: 'planetaryShield', displayOrder: 30, availability: 'COMING_LATER', availabilityMessage: 'Coming later.' },
];
exports.DEFENCE_BY_ID = Object.freeze(Object.fromEntries(exports.DEFENCE_CATALOGUE.map((entry) => [entry.id, entry])));
exports.ACTIVE_SHIPYARD_DEFENCE_KEYS = ['flakTurret', 'railBattery'];
function isActiveShipyardDefenceKey(value) {
    return typeof value === 'string' && exports.ACTIVE_SHIPYARD_DEFENCE_KEYS.includes(value);
}
function finite(label, value) {
    if (!Number.isFinite(value))
        throw new RangeError(`${label} must be finite`);
    return value;
}
function evaluateDefenceCatalogue(input) {
    const entry = exports.DEFENCE_BY_ID[input.id];
    const definition = constants_1.DEFENCES[input.id];
    const durationSeconds = input.durationForBaseSeconds(definition.buildTimeSeconds, input.shipyardLevel, input.economySpeed);
    const requirements = Object.entries(definition.requires ?? {}).map(([id, requiredLevel]) => {
        const currentLevel = finite(`${id} level`, input.buildingLevels[id] ?? input.researchLevels[id] ?? 0);
        return {
            id: id,
            requiredLevel: finite(`${id} requirement`, requiredLevel ?? 0),
            currentLevel,
            met: currentLevel >= (requiredLevel ?? 0),
            type: id in input.buildingLevels || id === 'shipyard' ? 'building' : 'research',
        };
    });
    const cost = { ...definition.cost };
    for (const [label, value] of Object.entries({ ...cost, attack: definition.attack, shield: definition.shield, armour: definition.armour }))
        finite(`${input.id} ${label}`, value);
    return {
        ...entry,
        key: definition.key,
        name: definition.name,
        cost,
        durationSeconds,
        statistics: { attack: definition.attack, shield: definition.shield, armour: definition.armour },
        requirements,
        meetsRequirements: requirements.every((requirement) => requirement.met),
    };
}

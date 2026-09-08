"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIPYARD_BY_ID = exports.SHIPYARD_CATALOGUE = exports.SHIPYARD_CATEGORIES = void 0;
exports.shipyardDurationForCatalogue = shipyardDurationForCatalogue;
exports.evaluateShipyardCatalogue = evaluateShipyardCatalogue;
const constants_1 = require("./constants");
exports.SHIPYARD_CATEGORIES = [
    { id: 'civilian', name: 'Civilian', displayOrder: 10 },
    { id: 'combat', name: 'Combat', displayOrder: 20 },
    { id: 'specialist', name: 'Specialist', displayOrder: 30 },
];
/** Presentation and availability metadata for every key that may be persisted in Ship. */
exports.SHIPYARD_CATALOGUE = [
    { id: 'scout', category: 'civilian', displayOrder: 10, missions: ['Explore, transport, deploy and fleet movement.'], effect: { status: 'PARTIAL', description: 'Fleet movement is active; no scout-only exploration rule is enforced.' } },
    { id: 'transporter', category: 'civilian', displayOrder: 20, missions: ['Transport, deploy, raid cargo and fleet movement.'], effect: { status: 'ACTIVE', description: 'Cargo capacity is used by fleet transport and raid resolution.' } },
    { id: 'colonyShip', category: 'civilian', displayOrder: 30, missions: ['Colonise an empty planet slot.'], effect: { status: 'ACTIVE', description: 'Colonisation requires and consumes a Colony Ship when founding succeeds.' } },
    { id: 'corvette', category: 'combat', displayOrder: 40, missions: ['Attack, raid, deploy and fleet movement.'], effect: { status: 'ACTIVE', description: 'Combat attack, shield and armour statistics are used in combat resolution.' } },
    { id: 'frigate', category: 'combat', displayOrder: 50, missions: ['Attack, raid, deploy and fleet movement.'], effect: { status: 'ACTIVE', description: 'Combat attack, shield and armour statistics are used in combat resolution.' } },
    { id: 'probe', category: 'specialist', displayOrder: 60, missions: ['Espionage and fleet movement.'], effect: { status: 'PARTIAL', description: 'Espionage reports are active, but the server does not require a Probe for an espionage mission.' } },
    { id: 'recycler', category: 'specialist', displayOrder: 70, missions: ['Recycle debris fields and fleet movement.'], effect: { status: 'PARTIAL', description: 'Debris recovery is active, but the server does not require a Recycler for a recycle mission.' } },
];
exports.SHIPYARD_BY_ID = Object.freeze(Object.fromEntries(exports.SHIPYARD_CATALOGUE.map((entry) => [entry.id, entry])));
function finite(label, value) {
    if (!Number.isFinite(value))
        throw new RangeError(`${label} must be finite`);
    return value;
}
function shipyardDurationForCatalogue(baseSeconds, shipyardLevel, economySpeed) {
    finite('Ship base duration', baseSeconds);
    finite('Shipyard level', shipyardLevel);
    finite('Economy speed', economySpeed);
    if (baseSeconds < 0 || shipyardLevel < 0 || economySpeed <= 0)
        throw new RangeError('Shipyard duration inputs must be non-negative, with a positive economy speed');
    return Math.max(Math.round((baseSeconds / Math.max(1, Math.log2(shipyardLevel + 2))) / economySpeed), 10);
}
function evaluateShipyardCatalogue(input) {
    const entry = exports.SHIPYARD_BY_ID[input.id];
    const definition = constants_1.SHIPS[input.id];
    const durationSeconds = shipyardDurationForCatalogue(definition.buildTimeSeconds, input.shipyardLevel, input.economySpeed);
    const requirements = Object.entries(definition.requires ?? {}).map(([id, requiredLevel]) => {
        const currentLevel = finite(`${id} level`, input.buildingLevels[id] ?? input.researchLevels[id] ?? 0);
        return { id, requiredLevel: finite(`${id} requirement`, requiredLevel ?? 0), currentLevel, met: currentLevel >= (requiredLevel ?? 0), type: id in input.buildingLevels || id === 'shipyard' ? 'building' : 'research' };
    });
    const cost = { ...definition.cost };
    for (const [label, value] of Object.entries({ ...cost, speed: definition.speed, cargo: definition.cargo, fuelPerDistance: definition.fuelPerDistance, attack: definition.attack, shield: definition.shield, armour: definition.armour }))
        finite(`${input.id} ${label}`, value);
    return { ...entry, key: definition.key, name: definition.name, description: definition.description, cost, durationSeconds, statistics: { cargo: definition.cargo, speed: definition.speed, fuelPerDistance: definition.fuelPerDistance, attack: definition.attack, shield: definition.shield, armour: definition.armour }, requirements, meetsRequirements: requirements.every((requirement) => requirement.met) };
}

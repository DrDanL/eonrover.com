"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const index_1 = require("./index");
(0, node_test_1.default)('shipyard catalogue contains each persisted ship exactly once in stable category order', () => {
    strict_1.default.deepEqual(index_1.SHIPYARD_CATALOGUE.map((entry) => entry.id), ['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'probe', 'recycler']);
    strict_1.default.deepEqual(new Set(index_1.SHIPYARD_CATALOGUE.map((entry) => entry.id)), new Set(Object.keys(index_1.SHIPS)));
});
(0, node_test_1.default)('shipyard catalogue exposes finite current definitions and prerequisite evaluation', () => {
    for (const entry of index_1.SHIPYARD_CATALOGUE) {
        const item = (0, index_1.evaluateShipyardCatalogue)({ id: entry.id, shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { espionageTech: 4, propulsionTheory: 4, weaponTech: 4, shieldTech: 4 } });
        strict_1.default.ok(Number.isFinite(item.durationSeconds) && item.durationSeconds >= 10);
        strict_1.default.ok(Object.values(item.statistics).every(Number.isFinite));
        strict_1.default.ok(item.requirements.every((requirement) => requirement.met));
    }
});
(0, node_test_1.default)('shipyard duration rejects invalid inputs', () => {
    for (const [baseSeconds, shipyardLevel, economySpeed] of [[NaN, 1, 1], [100, Infinity, 1], [100, 1, 0], [-1, 1, 1]])
        strict_1.default.throws(() => (0, index_1.shipyardDurationForCatalogue)(baseSeconds, shipyardLevel, economySpeed));
});
(0, node_test_1.default)('a completed Shipyard level 4 unlocks a Colony Ship without planned propulsion research', () => {
    const colonyShip = (0, index_1.evaluateShipyardCatalogue)({
        id: 'colonyShip',
        shipyardLevel: 4,
        economySpeed: 1,
        buildingLevels: { shipyard: 4 },
        researchLevels: {},
    });
    strict_1.default.deepEqual(colonyShip.requirements, [{ id: 'shipyard', requiredLevel: 4, currentLevel: 4, met: true, type: 'building' }]);
    strict_1.default.equal(colonyShip.meetsRequirements, true);
});
(0, node_test_1.default)('defence catalogue has stable allowlisted availability for Flak, Rail, and Planetary Shield', () => {
    strict_1.default.deepEqual(index_1.DEFENCE_CATALOGUE.map((entry) => [entry.id, entry.availability]), [['flakTurret', 'ACTIVE'], ['railBattery', 'ACTIVE'], ['planetaryShield', 'ACTIVE']]);
    strict_1.default.deepEqual(new Set(index_1.DEFENCE_CATALOGUE.map((entry) => entry.id)), new Set(Object.keys(index_1.DEFENCES)));
    strict_1.default.equal((0, index_1.isActiveShipyardDefenceKey)('flakTurret'), true);
    strict_1.default.equal((0, index_1.isActiveShipyardDefenceKey)('railBattery'), true);
    strict_1.default.equal((0, index_1.isActiveShipyardDefenceKey)('planetaryShield'), true);
    strict_1.default.equal((0, index_1.isActiveShipyardDefenceKey)('unknown'), false);
    const flak = (0, index_1.evaluateDefenceCatalogue)({ id: 'flakTurret', shipyardLevel: 1, economySpeed: 1, buildingLevels: { shipyard: 1 }, researchLevels: {}, durationForBaseSeconds: index_1.shipyardDurationForCatalogue });
    strict_1.default.deepEqual(flak.cost, { alloy: 2000, heliox: 0, aether: 0 });
    strict_1.default.equal(flak.durationSeconds, (0, index_1.shipyardDurationForCatalogue)(600, 1, 1));
    strict_1.default.deepEqual(flak.statistics, { attack: 40, shield: 10, armour: 2000 });
    strict_1.default.equal(flak.meetsRequirements, true);
    const railLocked = (0, index_1.evaluateDefenceCatalogue)({ id: 'railBattery', shipyardLevel: 4, economySpeed: 1, buildingLevels: { shipyard: 4 }, researchLevels: { weaponTech: 1 }, durationForBaseSeconds: index_1.shipyardDurationForCatalogue });
    strict_1.default.equal(railLocked.meetsRequirements, false);
    strict_1.default.deepEqual(railLocked.requirements.map((requirement) => [requirement.id, requirement.requiredLevel, requirement.currentLevel, requirement.met]), [['shipyard', 4, 4, true], ['weaponTech', 2, 1, false]]);
    const rail = (0, index_1.evaluateDefenceCatalogue)({ id: 'railBattery', shipyardLevel: 4, economySpeed: 1, buildingLevels: { shipyard: 4 }, researchLevels: { weaponTech: 2 }, durationForBaseSeconds: index_1.shipyardDurationForCatalogue });
    strict_1.default.equal(rail.meetsRequirements, true);
    strict_1.default.deepEqual(rail.cost, { alloy: 6000, heliox: 2000, aether: 0 });
    strict_1.default.equal(rail.durationSeconds, (0, index_1.shipyardDurationForCatalogue)(1500, 4, 1));
    const shieldLocked = (0, index_1.evaluateDefenceCatalogue)({ id: 'planetaryShield', shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { shieldTech: 3 }, durationForBaseSeconds: index_1.shipyardDurationForCatalogue });
    strict_1.default.equal(shieldLocked.meetsRequirements, false);
    const shield = (0, index_1.evaluateDefenceCatalogue)({ id: 'planetaryShield', shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { shieldTech: 4 }, durationForBaseSeconds: index_1.shipyardDurationForCatalogue });
    strict_1.default.equal(shield.meetsRequirements, true);
    strict_1.default.deepEqual(shield.cost, { alloy: 15000, heliox: 8000, aether: 1000 });
    strict_1.default.equal(shield.durationSeconds, (0, index_1.shipyardDurationForCatalogue)(5400, 6, 1));
});

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

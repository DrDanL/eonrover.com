"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const formulas_1 = require("./formulas");
const espionageDisclosure_1 = require("./espionageDisclosure");
const target = {
    publicIdentity: {
        coordinates: { galaxy: 2, system: 40, slot: 7 },
        planetName: 'Aster Vale',
        planetType: 'temperate',
        ownerUsername: 'defender',
    },
    resources: { alloy: 1200, heliox: 800, aether: 75 },
    completedBuildings: { alloyMine: 4, helioxExtractor: 2, researchLab: 0 },
    ships: { scout: 3, probe: 1, transporter: 0 },
    defences: { flakTurret: 5, railBattery: 0 },
};
function disclose(overrides = {}) {
    return (0, espionageDisclosure_1.discloseEspionageTarget)({
        attackerEspionageTechnology: 0,
        defenderEspionageTechnology: 0,
        target,
        ...overrides,
    });
}
function expectCode(code, action) {
    strict_1.default.throws(action, (error) => error instanceof espionageDisclosure_1.EspionageDisclosureError && error.code === code);
}
(0, node_test_1.default)('maps exact disclosure thresholds and each neighbouring score to named tiers', () => {
    const cases = [
        [0.399, 'IDENTITY'], [0.4, 'RESOURCES'], [0.401, 'RESOURCES'],
        [0.599, 'RESOURCES'], [0.6, 'BUILDINGS'], [0.601, 'BUILDINGS'],
        [0.799, 'BUILDINGS'], [0.8, 'FORCES'], [0.801, 'FORCES'],
    ];
    for (const [accuracy, tier] of cases)
        strict_1.default.equal((0, espionageDisclosure_1.espionageDisclosureTierForAccuracy)(accuracy), tier);
});
(0, node_test_1.default)('uses the established espionage accuracy formula for equal and unequal technology levels', () => {
    strict_1.default.equal((0, formulas_1.espionageAccuracy)(0, 0), 0.5);
    strict_1.default.equal(disclose().tier, 'RESOURCES');
    strict_1.default.equal((0, formulas_1.espionageAccuracy)(2, 0), 0.66);
    strict_1.default.equal(disclose({ attackerEspionageTechnology: 2 }).tier, 'BUILDINGS');
    strict_1.default.equal((0, formulas_1.espionageAccuracy)(4, 0), 0.8200000000000001);
    strict_1.default.equal(disclose({ attackerEspionageTechnology: 4 }).tier, 'FORCES');
    strict_1.default.equal((0, formulas_1.espionageAccuracy)(0, 2), 0.33999999999999997);
    strict_1.default.equal(disclose({ defenderEspionageTechnology: 2 }).tier, 'IDENTITY');
});
(0, node_test_1.default)('builds every disclosure tier from an exact allowlist', () => {
    const identity = disclose({ defenderEspionageTechnology: 2 });
    strict_1.default.deepEqual(Object.keys(identity), ['target', 'tier']);
    strict_1.default.deepEqual(Object.keys(identity.target), ['coordinates', 'planetName', 'planetType', 'ownerUsername']);
    const resources = disclose();
    strict_1.default.deepEqual(Object.keys(resources), ['target', 'tier', 'resources']);
    strict_1.default.deepEqual(resources.resources, target.resources);
    strict_1.default.equal('buildings' in resources, false);
    const buildings = disclose({ attackerEspionageTechnology: 2 });
    strict_1.default.deepEqual(Object.keys(buildings), ['target', 'tier', 'resources', 'buildings']);
    strict_1.default.deepEqual(buildings.buildings, { alloyMine: 4, helioxExtractor: 2 });
    strict_1.default.equal('ships' in buildings, false);
    strict_1.default.equal('defences' in buildings, false);
    const forces = disclose({ attackerEspionageTechnology: 4 });
    strict_1.default.deepEqual(Object.keys(forces), ['target', 'tier', 'resources', 'buildings', 'ships', 'defences']);
    strict_1.default.deepEqual(forces.ships, { probe: 1, scout: 3 });
    strict_1.default.deepEqual(forces.defences, { flakTurret: 5 });
});
(0, node_test_1.default)('never leaks over-complete snapshot fields or sensitive identifiers', () => {
    const overCompleteTarget = {
        ...target,
        internalPlanetId: 'planet-secret',
        missionIds: ['mission-secret'],
        resourcesInTransit: { alloy: 999 },
        publicIdentity: {
            ...target.publicIdentity,
            accountId: 'account-secret',
            email: 'defender@example.invalid',
            sessionToken: 'session-secret',
        },
        resources: { ...target.resources, rawPrismaMetadata: 'metadata-secret' },
        completedBuildings: { ...target.completedBuildings, constructionQueue: 'queue-secret' },
        ships: { ...target.ships, activeFleet: 'fleet-secret' },
        defences: { ...target.defences, internalDefenceId: 'defence-secret' },
    };
    const serialized = JSON.stringify((0, espionageDisclosure_1.discloseEspionageTarget)({
        attackerEspionageTechnology: 4,
        defenderEspionageTechnology: 0,
        target: overCompleteTarget,
        attackerAccountId: 'actor-secret',
    }));
    for (const secret of ['planet-secret', 'mission-secret', 'account-secret', 'defender@example.invalid', 'session-secret', 'metadata-secret', 'queue-secret', 'fleet-secret', 'defence-secret', 'actor-secret']) {
        strict_1.default.equal(serialized.includes(secret), false);
    }
});
(0, node_test_1.default)('is stable and canonicalises negative zero in report data', () => {
    const negativeZeroTarget = {
        ...target,
        resources: { alloy: -0, heliox: 0, aether: 0 },
        completedBuildings: { alloyMine: -0 },
        ships: { probe: -0 },
        defences: { flakTurret: -0 },
    };
    const input = { attackerEspionageTechnology: 4, defenderEspionageTechnology: 0, target: negativeZeroTarget };
    const first = (0, espionageDisclosure_1.discloseEspionageTarget)(input);
    const second = (0, espionageDisclosure_1.discloseEspionageTarget)(input);
    strict_1.default.equal(JSON.stringify(first), JSON.stringify(second));
    strict_1.default.equal(Object.is(first.resources?.alloy, -0), false);
    strict_1.default.deepEqual(first.buildings, {});
    strict_1.default.deepEqual(first.ships, {});
    strict_1.default.deepEqual(first.defences, {});
});
(0, node_test_1.default)('rejects invalid technology and snapshot numeric values', () => {
    expectCode('INVALID_TECHNOLOGY_LEVEL', () => disclose({ attackerEspionageTechnology: -1 }));
    expectCode('INVALID_TECHNOLOGY_LEVEL', () => disclose({ defenderEspionageTechnology: Number.POSITIVE_INFINITY }));
    expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, resources: { ...target.resources, alloy: Number.NaN } } }));
    expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, completedBuildings: { alloyMine: 1.5 } } }));
    expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, ships: { probe: Number.POSITIVE_INFINITY } } }));
    expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, defences: { flakTurret: -1 } } }));
    expectCode('INVALID_ACCURACY', () => (0, espionageDisclosure_1.espionageDisclosureTierForAccuracy)(1.01));
});

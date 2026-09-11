import assert from 'node:assert/strict';
import test from 'node:test';
import { espionageAccuracy } from './formulas';
import {
  discloseEspionageTarget,
  EspionageDisclosureError,
  EspionageDisclosureTier,
  espionageDisclosureTierForAccuracy,
} from './espionageDisclosure';

const target = {
  publicIdentity: {
    coordinates: { galaxy: 2, system: 40, slot: 7 },
    planetName: 'Aster Vale',
    planetType: 'temperate' as const,
    ownerUsername: 'defender',
  },
  resources: { alloy: 1200, heliox: 800, aether: 75 },
  completedBuildings: { alloyMine: 4, helioxExtractor: 2, researchLab: 0 },
  ships: { scout: 3, probe: 1, transporter: 0 },
  defences: { flakTurret: 5, railBattery: 0 },
};

function disclose(overrides: Record<string, unknown> = {}) {
  return discloseEspionageTarget({
    attackerEspionageTechnology: 0,
    defenderEspionageTechnology: 0,
    target,
    ...overrides,
  });
}

function expectCode(code: EspionageDisclosureError['code'], action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof EspionageDisclosureError && error.code === code);
}

test('maps exact disclosure thresholds and each neighbouring score to named tiers', () => {
  const cases: Array<[number, EspionageDisclosureTier]> = [
    [0.399, 'IDENTITY'], [0.4, 'RESOURCES'], [0.401, 'RESOURCES'],
    [0.599, 'RESOURCES'], [0.6, 'BUILDINGS'], [0.601, 'BUILDINGS'],
    [0.799, 'BUILDINGS'], [0.8, 'FORCES'], [0.801, 'FORCES'],
  ];
  for (const [accuracy, tier] of cases) assert.equal(espionageDisclosureTierForAccuracy(accuracy), tier);
});

test('uses the established espionage accuracy formula for equal and unequal technology levels', () => {
  assert.equal(espionageAccuracy(0, 0), 0.5);
  assert.equal(disclose().tier, 'RESOURCES');
  assert.equal(espionageAccuracy(2, 0), 0.66);
  assert.equal(disclose({ attackerEspionageTechnology: 2 }).tier, 'BUILDINGS');
  assert.equal(espionageAccuracy(4, 0), 0.8200000000000001);
  assert.equal(disclose({ attackerEspionageTechnology: 4 }).tier, 'FORCES');
  assert.equal(espionageAccuracy(0, 2), 0.33999999999999997);
  assert.equal(disclose({ defenderEspionageTechnology: 2 }).tier, 'IDENTITY');
});

test('builds every disclosure tier from an exact allowlist', () => {
  const identity = disclose({ defenderEspionageTechnology: 2 });
  assert.deepEqual(Object.keys(identity), ['target', 'tier']);
  assert.deepEqual(Object.keys(identity.target), ['coordinates', 'planetName', 'planetType', 'ownerUsername']);

  const resources = disclose();
  assert.deepEqual(Object.keys(resources), ['target', 'tier', 'resources']);
  assert.deepEqual(resources.resources, target.resources);
  assert.equal('buildings' in resources, false);

  const buildings = disclose({ attackerEspionageTechnology: 2 });
  assert.deepEqual(Object.keys(buildings), ['target', 'tier', 'resources', 'buildings']);
  assert.deepEqual(buildings.buildings, { alloyMine: 4, helioxExtractor: 2 });
  assert.equal('ships' in buildings, false);
  assert.equal('defences' in buildings, false);

  const forces = disclose({ attackerEspionageTechnology: 4 });
  assert.deepEqual(Object.keys(forces), ['target', 'tier', 'resources', 'buildings', 'ships', 'defences']);
  assert.deepEqual(forces.ships, { probe: 1, scout: 3 });
  assert.deepEqual(forces.defences, { flakTurret: 5 });
});

test('never leaks over-complete snapshot fields or sensitive identifiers', () => {
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
  const serialized = JSON.stringify(discloseEspionageTarget({
    attackerEspionageTechnology: 4,
    defenderEspionageTechnology: 0,
    target: overCompleteTarget,
    attackerAccountId: 'actor-secret',
  }));
  for (const secret of ['planet-secret', 'mission-secret', 'account-secret', 'defender@example.invalid', 'session-secret', 'metadata-secret', 'queue-secret', 'fleet-secret', 'defence-secret', 'actor-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('is stable and canonicalises negative zero in report data', () => {
  const negativeZeroTarget = {
    ...target,
    resources: { alloy: -0, heliox: 0, aether: 0 },
    completedBuildings: { alloyMine: -0 },
    ships: { probe: -0 },
    defences: { flakTurret: -0 },
  };
  const input = { attackerEspionageTechnology: 4, defenderEspionageTechnology: 0, target: negativeZeroTarget };
  const first = discloseEspionageTarget(input);
  const second = discloseEspionageTarget(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.is(first.resources?.alloy, -0), false);
  assert.deepEqual(first.buildings, {});
  assert.deepEqual(first.ships, {});
  assert.deepEqual(first.defences, {});
});

test('rejects invalid technology and snapshot numeric values', () => {
  expectCode('INVALID_TECHNOLOGY_LEVEL', () => disclose({ attackerEspionageTechnology: -1 }));
  expectCode('INVALID_TECHNOLOGY_LEVEL', () => disclose({ defenderEspionageTechnology: Number.POSITIVE_INFINITY }));
  expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, resources: { ...target.resources, alloy: Number.NaN } } }));
  expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, completedBuildings: { alloyMine: 1.5 } } }));
  expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, ships: { probe: Number.POSITIVE_INFINITY } } }));
  expectCode('INVALID_TARGET_SNAPSHOT', () => disclose({ target: { ...target, defences: { flakTurret: -1 } } }));
  expectCode('INVALID_ACCURACY', () => espionageDisclosureTierForAccuracy(1.01));
});

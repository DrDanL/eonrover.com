import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFENCE_CATALOGUE, DEFENCES, evaluateDefenceCatalogue, isActiveShipyardDefenceKey, SHIPS, SHIPYARD_CATALOGUE, evaluateShipyardCatalogue, shipyardDurationForCatalogue } from './index';

test('shipyard catalogue contains each persisted ship exactly once in stable category order', () => {
  assert.deepEqual(SHIPYARD_CATALOGUE.map((entry) => entry.id), ['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'probe', 'recycler']);
  assert.deepEqual(new Set(SHIPYARD_CATALOGUE.map((entry) => entry.id)), new Set(Object.keys(SHIPS)));
});

test('shipyard catalogue exposes finite current definitions and prerequisite evaluation', () => {
  for (const entry of SHIPYARD_CATALOGUE) {
    const item = evaluateShipyardCatalogue({ id: entry.id, shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { espionageTech: 4, propulsionTheory: 4, weaponTech: 4, shieldTech: 4 } });
    assert.ok(Number.isFinite(item.durationSeconds) && item.durationSeconds >= 10);
    assert.ok(Object.values(item.statistics).every(Number.isFinite));
    assert.ok(item.requirements.every((requirement) => requirement.met));
  }
});

test('shipyard duration rejects invalid inputs', () => {
  for (const [baseSeconds, shipyardLevel, economySpeed] of [[NaN, 1, 1], [100, Infinity, 1], [100, 1, 0], [-1, 1, 1]]) assert.throws(() => shipyardDurationForCatalogue(baseSeconds, shipyardLevel, economySpeed));
});

test('a completed Shipyard level 4 unlocks a Colony Ship without planned propulsion research', () => {
  const colonyShip = evaluateShipyardCatalogue({
    id: 'colonyShip',
    shipyardLevel: 4,
    economySpeed: 1,
    buildingLevels: { shipyard: 4 },
    researchLevels: {},
  });

  assert.deepEqual(colonyShip.requirements, [{ id: 'shipyard', requiredLevel: 4, currentLevel: 4, met: true, type: 'building' }]);
  assert.equal(colonyShip.meetsRequirements, true);
});

test('defence catalogue has stable allowlisted availability for Flak, Rail, and Planetary Shield', () => {
  assert.deepEqual(DEFENCE_CATALOGUE.map((entry) => [entry.id, entry.availability]), [['flakTurret', 'ACTIVE'], ['railBattery', 'ACTIVE'], ['planetaryShield', 'ACTIVE']]);
  assert.deepEqual(new Set(DEFENCE_CATALOGUE.map((entry) => entry.id)), new Set(Object.keys(DEFENCES)));
  assert.equal(isActiveShipyardDefenceKey('flakTurret'), true);
  assert.equal(isActiveShipyardDefenceKey('railBattery'), true);
  assert.equal(isActiveShipyardDefenceKey('planetaryShield'), true);
  assert.equal(isActiveShipyardDefenceKey('unknown'), false);
  const flak = evaluateDefenceCatalogue({ id: 'flakTurret', shipyardLevel: 1, economySpeed: 1, buildingLevels: { shipyard: 1 }, researchLevels: {}, durationForBaseSeconds: shipyardDurationForCatalogue });
  assert.deepEqual(flak.cost, { alloy: 2000, heliox: 0, aether: 0 });
  assert.equal(flak.durationSeconds, shipyardDurationForCatalogue(600, 1, 1));
  assert.deepEqual(flak.statistics, { attack: 40, shield: 10, armour: 2000 });
  assert.equal(flak.meetsRequirements, true);
  const railLocked = evaluateDefenceCatalogue({ id: 'railBattery', shipyardLevel: 4, economySpeed: 1, buildingLevels: { shipyard: 4 }, researchLevels: { weaponTech: 1 }, durationForBaseSeconds: shipyardDurationForCatalogue });
  assert.equal(railLocked.meetsRequirements, false);
  assert.deepEqual(railLocked.requirements.map((requirement) => [requirement.id, requirement.requiredLevel, requirement.currentLevel, requirement.met]), [['shipyard', 4, 4, true], ['weaponTech', 2, 1, false]]);
  const rail = evaluateDefenceCatalogue({ id: 'railBattery', shipyardLevel: 4, economySpeed: 1, buildingLevels: { shipyard: 4 }, researchLevels: { weaponTech: 2 }, durationForBaseSeconds: shipyardDurationForCatalogue });
  assert.equal(rail.meetsRequirements, true);
  assert.deepEqual(rail.cost, { alloy: 6000, heliox: 2000, aether: 0 });
  assert.equal(rail.durationSeconds, shipyardDurationForCatalogue(1500, 4, 1));
  const shieldLocked = evaluateDefenceCatalogue({ id: 'planetaryShield', shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { shieldTech: 3 }, durationForBaseSeconds: shipyardDurationForCatalogue });
  assert.equal(shieldLocked.meetsRequirements, false);
  const shield = evaluateDefenceCatalogue({ id: 'planetaryShield', shipyardLevel: 6, economySpeed: 1, buildingLevels: { shipyard: 6 }, researchLevels: { shieldTech: 4 }, durationForBaseSeconds: shipyardDurationForCatalogue });
  assert.equal(shield.meetsRequirements, true);
  assert.deepEqual(shield.cost, { alloy: 15000, heliox: 8000, aether: 1000 });
  assert.equal(shield.durationSeconds, shipyardDurationForCatalogue(5400, 6, 1));
});

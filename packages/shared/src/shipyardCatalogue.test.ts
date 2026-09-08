import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIPS, SHIPYARD_CATALOGUE, evaluateShipyardCatalogue, shipyardDurationForCatalogue } from './index';

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

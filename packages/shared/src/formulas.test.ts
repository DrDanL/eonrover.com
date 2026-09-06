import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accumulateProduction,
  buildingCost,
  calculatePlanetEnergy,
  distanceBetween,
  espionageAccuracy,
  flightDurationSeconds,
  projectBuildingEnergy,
  resolveCombat,
  scaledCost,
} from './formulas';
import { CombatUnit } from './formulas';
import { BUILDING_CATEGORIES, BUILDINGS } from './constants';

test('calculates current energy supply, demand and capacity state', () => {
  const energy = calculatePlanetEnergy({ alloyMine: 1, helioxExtractor: 1, solarArray: 1 }, 0.7);

  assert.equal(energy.supply, 46.4);
  assert.equal(energy.demand, 22);
  assert.equal(energy.available, 24.4);
  assert.equal(energy.utilisationPercentage, (22 / 46.4) * 100);
  assert.equal(energy.productionEfficiency, 1);
  assert.equal(energy.status, 'healthy');
});

test('projects supply and demand from the selected authoritative target level', () => {
  const projection = projectBuildingEnergy({ alloyMine: 1, solarArray: 1 }, 0.7, 'alloyMine', 2);

  assert.equal(projection.supply, 46.4);
  assert.equal(projection.demand, 10);
  assert.equal(projection.projectedSupply, 46.4);
  assert.equal(projection.projectedDemand, 20);
  assert.equal(projection.additionalEnergyRequired, 10);
  assert.equal(projection.projectedAvailable, 26.4);
});

test('allows an upgrade that reaches exact capacity', () => {
  const projection = projectBuildingEnergy({ alloyMine: 1 }, 0.7, 'alloyMine', 2);

  assert.equal(projection.projectedSupply, 20);
  assert.equal(projection.projectedDemand, 20);
  assert.equal(projection.shortfall, 0);
  assert.equal(projection.hasSufficientEnergy, true);
  assert.equal(projection.energyRequirementMet, true);
});

test('reports a one-unit energy shortfall', () => {
  const projection = projectBuildingEnergy(
    { alloyMine: 1, helioxExtractor: 1, solarArray: 1 },
    0,
    'alloyMine',
    2,
  );

  assert.equal(projection.projectedSupply, 31);
  assert.equal(projection.projectedDemand, 32);
  assert.equal(projection.shortfall, 1);
  assert.equal(projection.energyRequirementMet, false);
});

test('allows an energy-generating upgrade while the planet remains in deficit', () => {
  const projection = projectBuildingEnergy({ alloyMine: 4 }, 0, 'solarArray', 1);

  assert.equal(projection.status, 'deficit');
  assert.equal(projection.projectedSupply, 31);
  assert.equal(projection.projectedDemand, 40);
  assert.equal(projection.hasSufficientEnergy, false);
  assert.equal(projection.additionalEnergyRequired, 0);
  assert.equal(projection.energyRequirementMet, true);
});

test('allows a zero-demand facility while the planet remains in deficit', () => {
  const projection = projectBuildingEnergy({ alloyMine: 3 }, 0.7, 'researchLab', 1);

  assert.equal(projection.status, 'deficit');
  assert.equal(projection.projectedDemand, projection.demand);
  assert.equal(projection.additionalEnergyRequired, 0);
  assert.equal(projection.energyRequirementMet, true);
});

test('keeps legacy deficit planets valid with reduced production efficiency', () => {
  const energy = calculatePlanetEnergy({ alloyMine: 3 }, 0.7);

  assert.equal(energy.status, 'deficit');
  assert.equal(energy.available, -10);
  assert.equal(energy.productionEfficiency, 2 / 3);
});

test('rejects non-finite and invalid energy inputs', () => {
  assert.throws(() => calculatePlanetEnergy({}, Number.NaN), /finite/);
  assert.throws(() => calculatePlanetEnergy({ alloyMine: Number.POSITIVE_INFINITY }, 0.7), /finite/);
  assert.throws(() => calculatePlanetEnergy({ alloyMine: 1.5 }, 0.7), /non-negative integers/);
});

test('maps every implemented building to the deterministic category order', () => {
  assert.deepEqual(BUILDING_CATEGORIES.map((category) => category.key), [
    'resources',
    'energy',
    'infrastructure',
  ]);
  assert.deepEqual(
    Object.values(BUILDINGS).map(({ key, category }) => [key, category]),
    [
      ['alloyMine', 'resources'],
      ['helioxExtractor', 'resources'],
      ['aetherSynthesizer', 'resources'],
      ['solarArray', 'energy'],
      ['alloyStorage', 'resources'],
      ['helioxStorage', 'resources'],
      ['aetherStorage', 'resources'],
      ['shipyard', 'infrastructure'],
      ['researchLab', 'infrastructure'],
      ['gateObservatory', 'infrastructure'],
    ],
  );
});

test('scaledCost grows exponentially per level', () => {
  const l1 = scaledCost({ alloy: 60, heliox: 15, aether: 0 }, 1.5, 1);
  const l2 = scaledCost({ alloy: 60, heliox: 15, aether: 0 }, 1.5, 2);
  assert.equal(l1.alloy, 60);
  assert.equal(l2.alloy, 90);
});

test('buildingCost matches definitions', () => {
  const cost = buildingCost('alloyMine', 1);
  assert.equal(cost.alloy, 60);
  assert.equal(cost.heliox, 15);
});

test('accumulateProduction accrues and caps at storage capacity', () => {
  const gained = accumulateProduction(100, 3600, 3600, 5000);
  assert.equal(gained, 3700);
  const capped = accumulateProduction(4900, 3600, 3600, 5000);
  assert.equal(capped, 5000);
});

test('accumulateProduction is a no-op for non-positive elapsed time', () => {
  assert.equal(accumulateProduction(100, 3600, 0, 5000), 100);
  assert.equal(accumulateProduction(100, 3600, -10, 5000), 100);
});

test('distanceBetween scales by galaxy > system > slot', () => {
  const a = { galaxy: 1, system: 10, slot: 5 };
  const sameSystem = distanceBetween(a, { galaxy: 1, system: 10, slot: 8 });
  const otherSystem = distanceBetween(a, { galaxy: 1, system: 12, slot: 5 });
  const otherGalaxy = distanceBetween(a, { galaxy: 2, system: 10, slot: 5 });
  assert.ok(sameSystem < otherSystem);
  assert.ok(otherSystem < otherGalaxy);
});

test('flightDurationSeconds decreases as speed increases', () => {
  const slow = flightDurationSeconds(10000, 6000, 100, 1);
  const fast = flightDurationSeconds(10000, 12000, 100, 1);
  assert.ok(fast < slow);
});

test('espionageAccuracy is bounded between 0.1 and 1', () => {
  assert.equal(espionageAccuracy(0, 0), 0.5);
  assert.ok(espionageAccuracy(20, 0) <= 1);
  assert.ok(espionageAccuracy(0, 20) >= 0.1);
});

test('resolveCombat: overwhelming attacker force destroys defender', () => {
  const attackers: CombatUnit[] = Array.from({ length: 10 }, (_, i) => ({
    id: `a${i}`,
    key: 'corvette',
    attack: 60,
    shield: 15,
    armour: 3500,
    hull: 3500,
    owner: 'attacker',
  }));
  const defenders: CombatUnit[] = [
    { id: 'd0', key: 'flakTurret', attack: 40, shield: 10, armour: 2000, hull: 2000, owner: 'defender' },
  ];
  const result = resolveCombat(attackers, defenders, () => 0);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.survivorsDefender.length, 0);
  assert.ok(result.survivorsAttacker.length > 0);
});

test('resolveCombat: evenly matched single units can draw within round cap', () => {
  const attackers: CombatUnit[] = [
    { id: 'a0', key: 'scout', attack: 1, shield: 1, armour: 400, hull: 400, owner: 'attacker' },
  ];
  const defenders: CombatUnit[] = [
    { id: 'd0', key: 'flakTurret', attack: 1, shield: 1, armour: 2000, hull: 2000, owner: 'defender' },
  ];
  const result = resolveCombat(attackers, defenders, () => 0);
  assert.equal(result.outcome, 'draw');
  assert.equal(result.survivorsAttacker.length, 1);
  assert.equal(result.survivorsDefender.length, 1);
});

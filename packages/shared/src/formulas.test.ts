import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accumulateProduction,
  buildingCost,
  distanceBetween,
  espionageAccuracy,
  flightDurationSeconds,
  resolveCombat,
  scaledCost,
} from './formulas';
import { CombatUnit } from './formulas';

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

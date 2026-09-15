import assert from 'node:assert/strict';
import test from 'node:test';
import { FRIGATE_STRIKE_RESOLVER_VERSION, FrigateStrikeError, planFrigateStrike, resolveFrigateStrike } from './frigateStrike';

const route = { origin: { galaxy: 1, system: 1, slot: 1 }, target: { galaxy: 1, system: 3, slot: 4 }, quantity: 2, fleetSpeed: 1 };

test('plans only a fixed-speed bounded Frigate manifest with finite round-trip snapshots', () => {
  const plan = planFrigateStrike(route);
  assert.deepEqual(plan.ships, { frigate: 2 });
  assert.equal(plan.speedPercent, 100);
  assert.ok(Number.isSafeInteger(plan.outboundDurationSeconds) && plan.outboundDurationSeconds > 0);
  assert.ok(Number.isSafeInteger(plan.outboundFuelHeliox) && plan.outboundFuelHeliox >= 0);
  assert.equal(plan.outboundDurationSeconds, plan.returnDurationSeconds);
  assert.equal(plan.outboundFuelHeliox, plan.returnFuelHeliox);
});

test('rejects non-canonical quantities, cross-galaxy and same-coordinate targets', () => {
  assert.throws(() => planFrigateStrike({ ...route, quantity: 0 }), FrigateStrikeError);
  assert.throws(() => planFrigateStrike({ ...route, quantity: 1.5 }), FrigateStrikeError);
  assert.throws(() => planFrigateStrike({ ...route, target: { galaxy: 2, system: 3, slot: 4 } }), FrigateStrikeError);
  assert.throws(() => planFrigateStrike({ ...route, target: route.origin }), FrigateStrikeError);
  assert.throws(() => planFrigateStrike({ ...route, cargo: { alloy: 1 } }), FrigateStrikeError);
});

test('resolves a versioned Frigate strike deterministically and retains a safe Shield stalemate', () => {
  const input = { version: FRIGATE_STRIKE_RESOLVER_VERSION, seed: 'frigate-v1-fixture', attacker: { frigates: 10, technology: { weaponTech: 6, shieldTech: 6, armourTech: 6 } }, defender: { ships: {}, defences: { planetaryShield: 1 }, technology: { weaponTech: 6, shieldTech: 6, armourTech: 6 } } };
  const first = resolveFrigateStrike(input);
  assert.deepEqual(first, resolveFrigateStrike(input));
  assert.deepEqual({ outcome: first.outcome, termination: first.termination, survivors: first.survivors }, { outcome: 'draw', termination: 'stalemate', survivors: { attacker: { frigate: 10 }, defender: { planetaryShield: 1 } } });
});

test('uses explicit persisted inputs for technology and defender force snapshots', () => {
  const base = { version: FRIGATE_STRIKE_RESOLVER_VERSION, seed: 'frigate-v1-force-fixture', attacker: { frigates: 8, technology: { weaponTech: 3, shieldTech: 3, armourTech: 3 } }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 2, railBattery: 1 }, technology: { weaponTech: 3, shieldTech: 3, armourTech: 3 } } };
  const result = resolveFrigateStrike(base);
  assert.deepEqual(result, resolveFrigateStrike(base));
  assert.deepEqual(result.starting, { attacker: { frigate: 8 }, defender: { corvette: 2, flakTurret: 2, railBattery: 1 } });
  assert.throws(() => resolveFrigateStrike({ ...base, defender: { ...base.defender, ships: { unknown: 1 } } }), FrigateStrikeError);
});

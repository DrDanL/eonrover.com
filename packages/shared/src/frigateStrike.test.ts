import assert from 'node:assert/strict';
import test from 'node:test';
import { FRIGATE_STRIKE_RESOLVER_VERSION, FRIGATE_STRIKE_V1_RESOLVER_VERSION, FRIGATE_STRIKE_V2_RESOLVER_VERSION, FrigateStrikeError, planFrigateStrike, resolveFrigateStrike } from './frigateStrike';

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

test('retains the persisted v1 Shield stalemate exactly', () => {
  const input = { version: FRIGATE_STRIKE_V1_RESOLVER_VERSION, seed: 'frigate-v1-fixture', attacker: { frigates: 10, technology: { weaponTech: 6, shieldTech: 6, armourTech: 6 } }, defender: { ships: {}, defences: { planetaryShield: 1 }, technology: { weaponTech: 6, shieldTech: 6, armourTech: 6 } } };
  const first = resolveFrigateStrike(input);
  assert.deepEqual(first, resolveFrigateStrike(input));
  assert.deepEqual({ outcome: first.outcome, termination: first.termination, survivors: first.survivors }, { outcome: 'draw', termination: 'stalemate', survivors: { attacker: { frigate: 10 }, defender: { planetaryShield: 1 } } });
});

test('v2 Shield salvo has the documented equal-technology twelve-Frigate threshold', () => {
  for (const level of [0, 3, 6]) {
    const base = { version: FRIGATE_STRIKE_V2_RESOLVER_VERSION, seed: `shield-threshold-${level}`, defender: { ships: {}, defences: { planetaryShield: 1 }, technology: { weaponTech: level, shieldTech: level, armourTech: level } } };
    const eleven = resolveFrigateStrike({ ...base, attacker: { frigates: 11, technology: { weaponTech: level, shieldTech: level, armourTech: level } } });
    const twelve = resolveFrigateStrike({ ...base, attacker: { frigates: 12, technology: { weaponTech: level, shieldTech: level, armourTech: level } } });
    assert.deepEqual({ outcome: eleven.outcome, termination: eleven.termination, survivors: eleven.survivors }, { outcome: 'draw', termination: 'stalemate', survivors: { attacker: { frigate: 11 }, defender: { planetaryShield: 1 } } });
    assert.equal(twelve.outcome, 'attacker');
    assert.deepEqual(twelve.survivors.defender, {});
    assert.ok(twelve.rounds.length > 0 && twelve.rounds.length <= 512);
  }
});

test('v2 resolves one seeded Shield per phase without changing non-Shield Frigate outcomes', () => {
  const technology = { weaponTech: 0, shieldTech: 0, armourTech: 0 };
  const shields = resolveFrigateStrike({ version: FRIGATE_STRIKE_V2_RESOLVER_VERSION, seed: 'two-shields', attacker: { frigates: 12, technology }, defender: { ships: {}, defences: { planetaryShield: 2 }, technology } });
  const withFlak = resolveFrigateStrike({ version: FRIGATE_STRIKE_V2_RESOLVER_VERSION, seed: 'shield-flak', attacker: { frigates: 20, technology }, defender: { ships: {}, defences: { planetaryShield: 1, flakTurret: 1 }, technology } });
  const noShieldV1 = resolveFrigateStrike({ version: FRIGATE_STRIKE_V1_RESOLVER_VERSION, seed: 'ordinary-forces', attacker: { frigates: 8, technology }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 2, railBattery: 1 }, technology } });
  const noShieldV2 = resolveFrigateStrike({ version: FRIGATE_STRIKE_V2_RESOLVER_VERSION, seed: 'ordinary-forces', attacker: { frigates: 8, technology }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 2, railBattery: 1 }, technology } });
  assert.equal(shields.outcome, 'attacker');
  assert.equal(withFlak.starting.defender.planetaryShield, 1);
  assert.deepEqual({ outcome: noShieldV2.outcome, termination: noShieldV2.termination, survivors: noShieldV2.survivors, losses: noShieldV2.losses, rounds: noShieldV2.rounds }, { outcome: noShieldV1.outcome, termination: noShieldV1.termination, survivors: noShieldV1.survivors, losses: noShieldV1.losses, rounds: noShieldV1.rounds });
});

test('v2 uses explicit asymmetric technology and always returns finite non-negative forces', () => {
  const result = resolveFrigateStrike({ version: FRIGATE_STRIKE_V2_RESOLVER_VERSION, seed: 'asymmetric-shield', attacker: { frigates: 11, technology: { weaponTech: 6, shieldTech: 0, armourTech: 0 } }, defender: { ships: {}, defences: { planetaryShield: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } });
  assert.equal(result.outcome, 'attacker');
  for (const group of [result.starting.attacker, result.starting.defender, result.losses.attacker, result.losses.defender, result.survivors.attacker, result.survivors.defender]) for (const value of Object.values(group)) assert.ok(Number.isSafeInteger(value) && value >= 0);
});

test('uses explicit persisted inputs for technology and defender force snapshots', () => {
  const base = { version: FRIGATE_STRIKE_RESOLVER_VERSION, seed: 'frigate-v1-force-fixture', attacker: { frigates: 8, technology: { weaponTech: 3, shieldTech: 3, armourTech: 3 } }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 2, railBattery: 1 }, technology: { weaponTech: 3, shieldTech: 3, armourTech: 3 } } };
  const result = resolveFrigateStrike(base);
  assert.deepEqual(result, resolveFrigateStrike(base));
  assert.deepEqual(result.starting, { attacker: { frigate: 8 }, defender: { corvette: 2, flakTurret: 2, railBattery: 1 } });
  assert.throws(() => resolveFrigateStrike({ ...base, defender: { ...base.defender, ships: { unknown: 1 } } }), FrigateStrikeError);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { CORVETTE_STRIKE_RESOLVER_VERSION, CORVETTE_STRIKE_V1_RESOLVER_VERSION, CORVETTE_STRIKE_V2_SAFETY_ROUND_CAP, CorvetteStrikePlanError, CorvetteStrikeResolutionError, planCorvetteStrike, resolveCorvetteStrike } from './corvetteStrike';

const planInput = { origin: { galaxy: 1, system: 1, slot: 1 }, target: { galaxy: 1, system: 2, slot: 2 }, quantity: 2, fleetSpeed: 1 };
test('plans a fixed-speed canonical Corvette round trip', () => { const plan = planCorvetteStrike(planInput); assert.deepEqual(plan.ships, { corvette: 2 }); assert.equal(plan.speedPercent, 100); assert.ok(plan.outboundDurationSeconds > 0 && plan.outboundFuelHeliox >= 0); assert.equal(plan.outboundDurationSeconds, plan.returnDurationSeconds); });
test('rejects malformed strike input and non-local targets', () => { assert.throws(() => planCorvetteStrike({ ...planInput, speed: 10 }), CorvetteStrikePlanError); assert.throws(() => planCorvetteStrike({ ...planInput, target: { galaxy: 2, system: 2, slot: 2 } }), CorvetteStrikePlanError); assert.throws(() => planCorvetteStrike({ ...planInput, quantity: 1.5 }), CorvetteStrikePlanError); });
const resolutionInput = { version: CORVETTE_STRIKE_RESOLVER_VERSION, seed: 'fixed-server-seed', attacker: { corvettes: 3, technology: { weaponTech: 1, shieldTech: 0, armourTech: 0 } }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } };
test('resolves deterministically without mutating snapshots and reacts to a seed', () => { const before = JSON.stringify(resolutionInput); const first = resolveCorvetteStrike(resolutionInput); assert.deepEqual(first, resolveCorvetteStrike(resolutionInput)); assert.equal(JSON.stringify(resolutionInput), before); assert.notDeepEqual(first, resolveCorvetteStrike({ ...resolutionInput, seed: 'different-server-seed' })); });
test('applies active technology effects and rejects malformed force snapshots', () => { const weak = resolveCorvetteStrike({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } }); const strong = resolveCorvetteStrike({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 10, shieldTech: 0, armourTech: 0 } } }); assert.ok(Object.values(strong.losses.defender).reduce((a, b) => a + b, 0) >= Object.values(weak.losses.defender).reduce((a, b) => a + b, 0)); assert.throws(() => resolveCorvetteStrike({ ...resolutionInput, defender: { ...resolutionInput.defender, ships: { unknown: 1 } } }), CorvetteStrikeResolutionError); });

test('keeps the historical v1 fixed-six-round policy for already accepted missions', () => {
  const historical = resolveCorvetteStrike({ version: CORVETTE_STRIKE_V1_RESOLVER_VERSION, seed: 'stage13-rail-0', attacker: { corvettes: 10, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } }, defender: { ships: {}, defences: { railBattery: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } });
  assert.deepEqual(historical, resolveCorvetteStrike({ version: CORVETTE_STRIKE_V1_RESOLVER_VERSION, seed: 'stage13-rail-0', attacker: { corvettes: 10, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } }, defender: { ships: {}, defences: { railBattery: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } }));
  assert.deepEqual({ version: historical.version, outcome: historical.outcome, termination: historical.termination, rounds: historical.rounds.length, survivors: historical.survivors, losses: historical.losses }, { version: CORVETTE_STRIKE_V1_RESOLVER_VERSION, outcome: 'draw', termination: undefined, rounds: 6, survivors: { attacker: { corvette: 10 }, defender: { railBattery: 1 } }, losses: { attacker: {}, defender: {} } });
});

test('resolves the decisive v2 balance matrix deterministically at technology 0, 3, and 6', () => {
  const expected: Record<number, Array<{ name: string; corvettes: number; ships: Record<string, number>; defences: Record<string, number>; rounds: number; outcome: 'attacker' | 'defender' | 'draw'; attacker: Record<string, number>; defender: Record<string, number> }>> = {
    0: [
      { name: 'flak-1', corvettes: 1, ships: {}, defences: { flakTurret: 1 }, rounds: 40, outcome: 'attacker', attacker: { corvette: 1 }, defender: {} },
      { name: 'flak-3', corvettes: 1, ships: {}, defences: { flakTurret: 3 }, rounds: 47, outcome: 'defender', attacker: {}, defender: { flakTurret: 3 } },
      { name: 'flak-10-1', corvettes: 10, ships: {}, defences: { flakTurret: 1 }, rounds: 4, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-5', corvettes: 10, ships: {}, defences: { flakTurret: 5 }, rounds: 21, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-10', corvettes: 10, ships: {}, defences: { flakTurret: 10 }, rounds: 42, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-1', corvettes: 10, ships: {}, defences: { railBattery: 1 }, rounds: 18, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-3', corvettes: 10, ships: {}, defences: { railBattery: 3 }, rounds: 53, outcome: 'attacker', attacker: { corvette: 7 }, defender: {} },
      { name: 'shield-10', corvettes: 10, ships: {}, defences: { planetaryShield: 1 }, rounds: 0, outcome: 'draw', attacker: { corvette: 10 }, defender: { planetaryShield: 1 } },
      { name: 'corvette-10-3', corvettes: 10, ships: { corvette: 3 }, defences: {}, rounds: 24, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
    ],
    3: [
      { name: 'flak-1', corvettes: 1, ships: {}, defences: { flakTurret: 1 }, rounds: 40, outcome: 'attacker', attacker: { corvette: 1 }, defender: {} },
      { name: 'flak-3', corvettes: 1, ships: {}, defences: { flakTurret: 3 }, rounds: 47, outcome: 'defender', attacker: {}, defender: { flakTurret: 3 } },
      { name: 'flak-10-1', corvettes: 10, ships: {}, defences: { flakTurret: 1 }, rounds: 4, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-5', corvettes: 10, ships: {}, defences: { flakTurret: 5 }, rounds: 21, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-10', corvettes: 10, ships: {}, defences: { flakTurret: 10 }, rounds: 41, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-1', corvettes: 10, ships: {}, defences: { railBattery: 1 }, rounds: 18, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-3', corvettes: 10, ships: {}, defences: { railBattery: 3 }, rounds: 58, outcome: 'attacker', attacker: { corvette: 4 }, defender: {} },
      { name: 'shield-10', corvettes: 10, ships: {}, defences: { planetaryShield: 1 }, rounds: 0, outcome: 'draw', attacker: { corvette: 10 }, defender: { planetaryShield: 1 } },
      { name: 'corvette-10-3', corvettes: 10, ships: { corvette: 3 }, defences: {}, rounds: 24, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
    ],
    6: [
      { name: 'flak-1', corvettes: 1, ships: {}, defences: { flakTurret: 1 }, rounds: 40, outcome: 'attacker', attacker: { corvette: 1 }, defender: {} },
      { name: 'flak-3', corvettes: 1, ships: {}, defences: { flakTurret: 3 }, rounds: 47, outcome: 'defender', attacker: {}, defender: { flakTurret: 3 } },
      { name: 'flak-10-1', corvettes: 10, ships: {}, defences: { flakTurret: 1 }, rounds: 4, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-5', corvettes: 10, ships: {}, defences: { flakTurret: 5 }, rounds: 21, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'flak-10-10', corvettes: 10, ships: {}, defences: { flakTurret: 10 }, rounds: 41, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-1', corvettes: 10, ships: {}, defences: { railBattery: 1 }, rounds: 18, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
      { name: 'rail-10-3', corvettes: 10, ships: {}, defences: { railBattery: 3 }, rounds: 57, outcome: 'attacker', attacker: { corvette: 6 }, defender: {} },
      { name: 'shield-10', corvettes: 10, ships: {}, defences: { planetaryShield: 1 }, rounds: 0, outcome: 'draw', attacker: { corvette: 10 }, defender: { planetaryShield: 1 } },
      { name: 'corvette-10-3', corvettes: 10, ships: { corvette: 3 }, defences: {}, rounds: 24, outcome: 'attacker', attacker: { corvette: 10 }, defender: {} },
    ],
  };
  for (const [levelText, fixtures] of Object.entries(expected)) {
    const level = Number(levelText); const technology = { weaponTech: level, shieldTech: level, armourTech: level };
    for (const fixture of fixtures) {
      const input = { version: CORVETTE_STRIKE_RESOLVER_VERSION, seed: `stage14-v2-${level}-${fixture.name}`, attacker: { corvettes: fixture.corvettes, technology }, defender: { ships: fixture.ships, defences: fixture.defences, technology } };
      const result = resolveCorvetteStrike(input);
      assert.deepEqual(result, resolveCorvetteStrike(input), fixture.name);
      assert.deepEqual({ outcome: result.outcome, termination: result.termination, rounds: result.rounds.length, starting: result.starting, survivors: result.survivors, losses: result.losses }, { outcome: fixture.outcome, termination: fixture.outcome === 'draw' ? 'stalemate' : 'elimination', rounds: fixture.rounds, starting: { attacker: { corvette: fixture.corvettes }, defender: { ...fixture.ships, ...fixture.defences } }, survivors: { attacker: fixture.attacker, defender: fixture.defender }, losses: { attacker: fixture.corvettes === (fixture.attacker.corvette ?? 0) ? {} : { corvette: fixture.corvettes - (fixture.attacker.corvette ?? 0) }, defender: Object.fromEntries(Object.entries({ ...fixture.ships, ...fixture.defences }).filter(([key, count]) => count !== (fixture.defender[key] ?? 0)).map(([key, count]) => [key, count - (fixture.defender[key] ?? 0)])) } }, fixture.name);
      for (const group of [result.starting.attacker, result.starting.defender, result.survivors.attacker, result.survivors.defender, result.losses.attacker, result.losses.defender]) for (const amount of Object.values(group)) assert.ok(Number.isFinite(amount) && amount >= 0);
    }
  }
});

test('uses a typed unresolved safety-cap result instead of an ordinary draw', () => {
  const result = resolveCorvetteStrike({ version: CORVETTE_STRIKE_RESOLVER_VERSION, seed: 'stage14-v2-safety-cap', attacker: { corvettes: 1, technology: { weaponTech: 0, shieldTech: 1000, armourTech: 0 } }, defender: { ships: {}, defences: { flakTurret: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 1000 } } });
  assert.deepEqual({ outcome: result.outcome, termination: result.termination, rounds: result.rounds.length, survivors: result.survivors }, { outcome: 'unresolved', termination: 'safety-cap', rounds: CORVETTE_STRIKE_V2_SAFETY_ROUND_CAP, survivors: { attacker: { corvette: 1 }, defender: { flakTurret: 1 } } });
});

test('applies asymmetric research predictably under the decisive v2 policy', () => {
  const technology = (level: number) => ({ weaponTech: level, shieldTech: level, armourTech: level });
  const resolve = (attackerLevel: number, defenderLevel: number) => resolveCorvetteStrike({ version: CORVETTE_STRIKE_RESOLVER_VERSION, seed: `stage14-asym-${attackerLevel}-${defenderLevel}`, attacker: { corvettes: 10, technology: technology(attackerLevel) }, defender: { ships: {}, defences: { railBattery: 3 }, technology: technology(defenderLevel) } });
  const strongerAttacker = resolve(6, 0); const strongerDefender = resolve(0, 6);
  assert.deepEqual({ outcome: strongerAttacker.outcome, rounds: strongerAttacker.rounds.length, survivors: strongerAttacker.survivors, losses: strongerAttacker.losses }, { outcome: 'attacker', rounds: 27, survivors: { attacker: { corvette: 10 }, defender: {} }, losses: { attacker: {}, defender: { railBattery: 3 } } });
  assert.deepEqual({ outcome: strongerDefender.outcome, rounds: strongerDefender.rounds.length, survivors: strongerDefender.survivors, losses: strongerDefender.losses }, { outcome: 'defender', rounds: 37, survivors: { attacker: {}, defender: { railBattery: 3 } }, losses: { attacker: { corvette: 10 }, defender: {} } });
});

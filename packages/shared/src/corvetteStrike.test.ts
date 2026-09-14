import assert from 'node:assert/strict';
import test from 'node:test';
import { CORVETTE_STRIKE_RESOLVER_VERSION, CorvetteStrikePlanError, CorvetteStrikeResolutionError, planCorvetteStrike, resolveCorvetteStrike } from './corvetteStrike';

const planInput = { origin: { galaxy: 1, system: 1, slot: 1 }, target: { galaxy: 1, system: 2, slot: 2 }, quantity: 2, fleetSpeed: 1 };
test('plans a fixed-speed canonical Corvette round trip', () => { const plan = planCorvetteStrike(planInput); assert.deepEqual(plan.ships, { corvette: 2 }); assert.equal(plan.speedPercent, 100); assert.ok(plan.outboundDurationSeconds > 0 && plan.outboundFuelHeliox >= 0); assert.equal(plan.outboundDurationSeconds, plan.returnDurationSeconds); });
test('rejects malformed strike input and non-local targets', () => { assert.throws(() => planCorvetteStrike({ ...planInput, speed: 10 }), CorvetteStrikePlanError); assert.throws(() => planCorvetteStrike({ ...planInput, target: { galaxy: 2, system: 2, slot: 2 } }), CorvetteStrikePlanError); assert.throws(() => planCorvetteStrike({ ...planInput, quantity: 1.5 }), CorvetteStrikePlanError); });
const resolutionInput = { version: CORVETTE_STRIKE_RESOLVER_VERSION, seed: 'fixed-server-seed', attacker: { corvettes: 3, technology: { weaponTech: 1, shieldTech: 0, armourTech: 0 } }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } };
test('resolves deterministically without mutating snapshots and reacts to a seed', () => { const before = JSON.stringify(resolutionInput); const first = resolveCorvetteStrike(resolutionInput); assert.deepEqual(first, resolveCorvetteStrike(resolutionInput)); assert.equal(JSON.stringify(resolutionInput), before); assert.notDeepEqual(first, resolveCorvetteStrike({ ...resolutionInput, seed: 'different-server-seed' })); });
test('applies active technology effects and rejects malformed force snapshots', () => { const weak = resolveCorvetteStrike({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } }); const strong = resolveCorvetteStrike({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 10, shieldTech: 0, armourTech: 0 } } }); assert.ok(Object.values(strong.losses.defender).reduce((a, b) => a + b, 0) >= Object.values(weak.losses.defender).reduce((a, b) => a + b, 0)); assert.throws(() => resolveCorvetteStrike({ ...resolutionInput, defender: { ...resolutionInput.defender, ships: { unknown: 1 } } }), CorvetteStrikeResolutionError); });

test('documents deterministic current Corvette-versus-defence balance fixtures at technology 0, 3, and 6', () => {
  for (const technologyLevel of [0, 3, 6]) {
    const technology = { weaponTech: technologyLevel, shieldTech: technologyLevel, armourTech: technologyLevel };
    const resolve = (seed: string, corvettes: number, ships: Record<string, number>, defences: Record<string, number>) => resolveCorvetteStrike({ version: CORVETTE_STRIKE_RESOLVER_VERSION, seed, attacker: { corvettes, technology }, defender: { ships, defences, technology } });
    const flak = resolve(`stage13-flak-${technologyLevel}`, 10, {}, { flakTurret: 1 });
    assert.deepEqual({ outcome: flak.outcome, attacker: flak.survivors.attacker, defender: flak.survivors.defender, rounds: flak.rounds.length }, { outcome: 'attacker', attacker: { corvette: 10 }, defender: {}, rounds: 4 });
    const rail = resolve(`stage13-rail-${technologyLevel}`, 10, {}, { railBattery: 1 });
    const shield = resolve(`stage13-shield-${technologyLevel}`, 10, {}, { planetaryShield: 1 });
    const control = resolve(`stage13-control-${technologyLevel}`, 10, { corvette: 3 }, {});
    for (const result of [rail, shield, control]) {
      assert.equal(result.outcome, 'draw');
      assert.equal(result.rounds.length, 6);
      assert.deepEqual(result.losses, { attacker: {}, defender: {} });
    }
    const swarm = resolve(`stage13-flak-swarm-${technologyLevel}`, 20, {}, { flakTurret: 10 });
    assert.deepEqual({ outcome: swarm.outcome, rounds: swarm.rounds.length, losses: swarm.losses }, { outcome: 'draw', rounds: 6, losses: { attacker: {}, defender: {} } });
  }
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const corvetteStrike_1 = require("./corvetteStrike");
const planInput = { origin: { galaxy: 1, system: 1, slot: 1 }, target: { galaxy: 1, system: 2, slot: 2 }, quantity: 2, fleetSpeed: 1 };
(0, node_test_1.default)('plans a fixed-speed canonical Corvette round trip', () => { const plan = (0, corvetteStrike_1.planCorvetteStrike)(planInput); strict_1.default.deepEqual(plan.ships, { corvette: 2 }); strict_1.default.equal(plan.speedPercent, 100); strict_1.default.ok(plan.outboundDurationSeconds > 0 && plan.outboundFuelHeliox >= 0); strict_1.default.equal(plan.outboundDurationSeconds, plan.returnDurationSeconds); });
(0, node_test_1.default)('rejects malformed strike input and non-local targets', () => { strict_1.default.throws(() => (0, corvetteStrike_1.planCorvetteStrike)({ ...planInput, speed: 10 }), corvetteStrike_1.CorvetteStrikePlanError); strict_1.default.throws(() => (0, corvetteStrike_1.planCorvetteStrike)({ ...planInput, target: { galaxy: 2, system: 2, slot: 2 } }), corvetteStrike_1.CorvetteStrikePlanError); strict_1.default.throws(() => (0, corvetteStrike_1.planCorvetteStrike)({ ...planInput, quantity: 1.5 }), corvetteStrike_1.CorvetteStrikePlanError); });
const resolutionInput = { version: corvetteStrike_1.CORVETTE_STRIKE_RESOLVER_VERSION, seed: 'fixed-server-seed', attacker: { corvettes: 3, technology: { weaponTech: 1, shieldTech: 0, armourTech: 0 } }, defender: { ships: { corvette: 2 }, defences: { flakTurret: 1 }, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } };
(0, node_test_1.default)('resolves deterministically without mutating snapshots and reacts to a seed', () => { const before = JSON.stringify(resolutionInput); const first = (0, corvetteStrike_1.resolveCorvetteStrike)(resolutionInput); strict_1.default.deepEqual(first, (0, corvetteStrike_1.resolveCorvetteStrike)(resolutionInput)); strict_1.default.equal(JSON.stringify(resolutionInput), before); strict_1.default.notDeepEqual(first, (0, corvetteStrike_1.resolveCorvetteStrike)({ ...resolutionInput, seed: 'different-server-seed' })); });
(0, node_test_1.default)('applies active technology effects and rejects malformed force snapshots', () => { const weak = (0, corvetteStrike_1.resolveCorvetteStrike)({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 0, shieldTech: 0, armourTech: 0 } } }); const strong = (0, corvetteStrike_1.resolveCorvetteStrike)({ ...resolutionInput, attacker: { ...resolutionInput.attacker, technology: { weaponTech: 10, shieldTech: 0, armourTech: 0 } } }); strict_1.default.ok(Object.values(strong.losses.defender).reduce((a, b) => a + b, 0) >= Object.values(weak.losses.defender).reduce((a, b) => a + b, 0)); strict_1.default.throws(() => (0, corvetteStrike_1.resolveCorvetteStrike)({ ...resolutionInput, defender: { ...resolutionInput.defender, ships: { unknown: 1 } } }), corvetteStrike_1.CorvetteStrikeResolutionError); });
(0, node_test_1.default)('documents deterministic current Corvette-versus-defence balance fixtures at technology 0, 3, and 6', () => {
    for (const technologyLevel of [0, 3, 6]) {
        const technology = { weaponTech: technologyLevel, shieldTech: technologyLevel, armourTech: technologyLevel };
        const resolve = (seed, corvettes, ships, defences) => (0, corvetteStrike_1.resolveCorvetteStrike)({ version: corvetteStrike_1.CORVETTE_STRIKE_RESOLVER_VERSION, seed, attacker: { corvettes, technology }, defender: { ships, defences, technology } });
        const flak = resolve(`stage13-flak-${technologyLevel}`, 10, {}, { flakTurret: 1 });
        strict_1.default.deepEqual({ outcome: flak.outcome, attacker: flak.survivors.attacker, defender: flak.survivors.defender, rounds: flak.rounds.length }, { outcome: 'attacker', attacker: { corvette: 10 }, defender: {}, rounds: 4 });
        const rail = resolve(`stage13-rail-${technologyLevel}`, 10, {}, { railBattery: 1 });
        const shield = resolve(`stage13-shield-${technologyLevel}`, 10, {}, { planetaryShield: 1 });
        const control = resolve(`stage13-control-${technologyLevel}`, 10, { corvette: 3 }, {});
        for (const result of [rail, shield, control]) {
            strict_1.default.equal(result.outcome, 'draw');
            strict_1.default.equal(result.rounds.length, 6);
            strict_1.default.deepEqual(result.losses, { attacker: {}, defender: {} });
        }
        const swarm = resolve(`stage13-flak-swarm-${technologyLevel}`, 20, {}, { flakTurret: 10 });
        strict_1.default.deepEqual({ outcome: swarm.outcome, rounds: swarm.rounds.length, losses: swarm.losses }, { outcome: 'draw', rounds: 6, losses: { attacker: {}, defender: {} } });
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalDeployShips, planDeploy } from './deployMission';

const origin = { galaxy: 1, system: 1, slot: 1 }; const destination = { galaxy: 1, system: 2, slot: 1 };
test('canonicalises deploy manifests in stable ship-key order', () => assert.deepEqual(canonicalDeployShips({ transporter: 2, scout: 1 }), { scout: 1, transporter: 2 }));
test('rejects invalid, spoofed or empty manifests', () => { for (const value of [{ unknown: 1 }, { scout: 0 }, { scout: 1.5 }, { scout: Infinity }, [], null]) assert.throws(() => canonicalDeployShips(value)); });
test('rejects unsupported speeds and cargo', () => { assert.throws(() => planDeploy({ ships: { scout: 1 }, speedPercent: 9, origin, destination, fleetSpeed: 1 })); assert.throws(() => planDeploy({ ships: { scout: 1 }, speedPercent: 100, origin, destination, fleetSpeed: 1, cargo: {} })); });
test('calculates finite stable fuel and duration for equivalent manifests', () => { const a = planDeploy({ ships: { transporter: 2, scout: 1 }, speedPercent: 100, origin, destination, fleetSpeed: 1 }); const b = planDeploy({ ships: { scout: 1, transporter: 2 }, speedPercent: 100, origin, destination, fleetSpeed: 1 }); assert.deepEqual(a, b); assert.ok(Number.isFinite(a.durationSeconds) && Number.isFinite(a.fuelHeliox)); });

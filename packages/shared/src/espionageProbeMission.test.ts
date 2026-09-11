import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';
import {
  ESPIONAGE_PROBE_SPEED_PERCENT,
  EspionageProbePlanError,
  planEspionageProbeMission,
} from './espionageProbeMission';

const origin = { galaxy: 2, system: 40, slot: 4 };
const adjacentTarget = { galaxy: 2, system: 40, slot: 5 };
const distantTarget = { galaxy: 2, system: 400, slot: 12 };

function plan(overrides: Record<string, unknown> = {}) {
  return planEspionageProbeMission({ origin, target: adjacentTarget, fleetSpeed: 1, ...overrides });
}

function expectCode(code: EspionageProbePlanError['code'], action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof EspionageProbePlanError && error.code === code);
}

test('plans an adjacent same-galaxy Probe journey with canonical fixed values', () => {
  const distance = distanceBetween(origin, adjacentTarget);
  const duration = flightDurationSeconds(distance, SHIPS.probe.speed, ESPIONAGE_PROBE_SPEED_PERCENT, 1);
  const fuel = fuelConsumption({ probe: 1 }, distance, duration);

  assert.deepEqual(plan(), {
    ships: { probe: 1 },
    speedPercent: 100,
    outboundDurationSeconds: duration,
    returnDurationSeconds: duration,
    outboundFuelHeliox: fuel,
    returnFuelHeliox: fuel,
    timing: { arrivalAfterDepartureSeconds: duration, returnAfterArrivalSeconds: duration },
  });
});

test('uses the existing travel rules for a distant same-galaxy target', () => {
  const result = plan({ target: distantTarget, fleetSpeed: 2 });
  const distance = distanceBetween(origin, distantTarget);
  const expectedDuration = flightDurationSeconds(distance, SHIPS.probe.speed, ESPIONAGE_PROBE_SPEED_PERCENT, 2);
  const expectedFuel = fuelConsumption({ probe: 1 }, distance, expectedDuration);

  assert.equal(result.outboundDurationSeconds, expectedDuration);
  assert.equal(result.outboundFuelHeliox, expectedFuel);
  assert.ok(Number.isInteger(result.outboundDurationSeconds) && result.outboundDurationSeconds > 0);
  assert.ok(Number.isSafeInteger(result.outboundFuelHeliox) && result.outboundFuelHeliox >= 0);
  assert.equal(result.returnDurationSeconds, result.outboundDurationSeconds);
  assert.equal(result.returnFuelHeliox, result.outboundFuelHeliox);
});

test('rejects coordinates outside shared Galaxy bounds and malformed coordinate values', () => {
  for (const invalid of [
    { galaxy: 0, system: 1, slot: 1 },
    { galaxy: 7, system: 1, slot: 1 },
    { galaxy: 1, system: 0, slot: 1 },
    { galaxy: 1, system: 401, slot: 1 },
    { galaxy: 1, system: 1, slot: 0 },
    { galaxy: 1, system: 1, slot: 13 },
    { galaxy: 1.5, system: 1, slot: 1 },
    { galaxy: 1, system: Number.POSITIVE_INFINITY, slot: 1 },
    { galaxy: '1', system: 1, slot: 1 },
    { galaxy: 1, system: 1, slot: 1, planetId: 'not-allowed' },
  ]) {
    expectCode('INVALID_COORDINATES', () => plan({ target: invalid }));
  }
});

test('rejects same-coordinate and cross-galaxy probe targets', () => {
  expectCode('IDENTICAL_COORDINATES', () => plan({ target: origin }));
  expectCode('CROSS_GALAXY_TARGET', () => plan({ target: { galaxy: 3, system: 40, slot: 5 } }));
});

test('rejects every caller-controlled mission field so it cannot affect the canonical plan', () => {
  for (const injection of [
    { ships: { probe: 10 } },
    { manifest: { probe: 1 } },
    { cargo: { alloy: 1 } },
    { speedPercent: 10 },
    { durationSeconds: 1 },
    { fuelHeliox: 0 },
    { reportAccuracy: 1 },
    { targetPlanetId: 'untrusted-target' },
  ]) {
    expectCode('INVALID_INPUT', () => plan(injection));
  }
  expectCode('INVALID_FLEET_SPEED', () => plan({ fleetSpeed: 0 }));
});

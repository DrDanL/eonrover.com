import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';
import {
  MAX_TRANSPORTER_QUANTITY,
  TRANSPORT_SPEED_PERCENT,
  TransportPlanError,
  planTransportMission,
} from './transportMission';

const origin = { galaxy: 1, system: 10, slot: 3 };
const destination = { galaxy: 1, system: 14, slot: 8 };
const cargo = { alloy: 1250, heliox: 700, aether: 50 };

function plan(overrides: Record<string, unknown> = {}) {
  return planTransportMission({ origin, destination, quantity: 2, cargo, fleetSpeed: 1, ...overrides });
}

function expectCode(code: TransportPlanError['code'], action: () => unknown) {
  assert.throws(action, (error: unknown) => error instanceof TransportPlanError && error.code === code);
}

test('plans a canonical fixed-speed Transporter round trip from known coordinates', () => {
  const distance = distanceBetween(origin, destination);
  const duration = flightDurationSeconds(distance, SHIPS.transporter.speed, TRANSPORT_SPEED_PERCENT, 1);
  const fuel = fuelConsumption({ transporter: 2 }, distance, duration);

  assert.deepEqual(plan(), {
    ships: { transporter: 2 },
    speedPercent: 100,
    cargo,
    cargoCapacity: SHIPS.transporter.cargo * 2,
    usedCargoCapacity: 2000,
    remainingCargoCapacity: SHIPS.transporter.cargo * 2 - 2000,
    outboundDurationSeconds: duration,
    returnDurationSeconds: duration,
    outboundFuelHeliox: fuel,
    returnFuelHeliox: fuel,
    totalReservedFuelHeliox: fuel * 2,
    timing: { arrivalAfterDepartureSeconds: duration, returnAfterArrivalSeconds: duration },
  });
});

test('uses one canonical Transporter manifest and fixed 100 percent speed', () => {
  const result = plan({ quantity: 1, cargo: { alloy: 1, heliox: 0, aether: 0 } });
  assert.deepEqual(result.ships, { transporter: 1 });
  assert.equal(result.speedPercent, TRANSPORT_SPEED_PERCENT);
  expectCode('INVALID_INPUT', () => plan({ speedPercent: 10 }));
  expectCode('INVALID_INPUT', () => plan({ ships: { scout: 1 } }));
  expectCode('INVALID_INPUT', () => plan({ returnPolicy: 'manual' }));
});

test('enforces single and multiple Transporter cargo capacity', () => {
  assert.equal(plan({ quantity: 1, cargo: { alloy: 4000, heliox: 0, aether: 0 } }).cargoCapacity, 4000);
  assert.equal(plan({ quantity: 2, cargo: { alloy: 8000, heliox: 0, aether: 0 } }).remainingCargoCapacity, 0);
  expectCode('CARGO_CAPACITY_EXCEEDED', () => plan({ quantity: 1, cargo: { alloy: 4001, heliox: 0, aether: 0 } }));
});

test('counts Heliox as cargo while keeping round-trip fuel separate', () => {
  const result = plan({ quantity: 1, cargo: { alloy: 0, heliox: 4000, aether: 0 } });
  assert.equal(result.usedCargoCapacity, 4000);
  assert.equal(result.remainingCargoCapacity, 0);
  assert.ok(result.outboundFuelHeliox > 0);
  assert.equal(result.totalReservedFuelHeliox, result.outboundFuelHeliox + result.returnFuelHeliox);
});

test('rejects invalid cargo values and shapes without coercion', () => {
  for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: value, heliox: 0, aether: 1 } }));
  }
  expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: 1, heliox: 0 } }));
  expectCode('INVALID_CARGO', () => plan({ cargo: { alloy: 1, heliox: 0, aether: 0, darkMatter: 1 } }));
  expectCode('INVALID_CARGO', () => plan({ cargo: [] }));
});

test('rejects empty cargo and invalid Transporter quantities', () => {
  expectCode('EMPTY_CARGO', () => plan({ cargo: { alloy: 0, heliox: 0, aether: 0 } }));
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TRANSPORTER_QUANTITY + 1]) {
    expectCode('INVALID_QUANTITY', () => plan({ quantity }));
  }
});

test('rejects identical or invalid coordinates', () => {
  expectCode('IDENTICAL_COORDINATES', () => plan({ destination: origin }));
  expectCode('INVALID_COORDINATES', () => plan({ origin: { galaxy: 0, system: 1, slot: 1 } }));
  expectCode('INVALID_COORDINATES', () => plan({ destination: { galaxy: 1, system: 1.5, slot: 1 } }));
  expectCode('INVALID_COORDINATES', () => plan({ destination: { galaxy: 1, system: 1, slot: Number.POSITIVE_INFINITY } }));
});

test('returns finite positive travel durations and finite round-trip fuel', () => {
  const result = plan({ fleetSpeed: 3 });
  assert.ok(Number.isInteger(result.outboundDurationSeconds) && result.outboundDurationSeconds > 0);
  assert.ok(Number.isInteger(result.returnDurationSeconds) && result.returnDurationSeconds > 0);
  assert.ok(Number.isSafeInteger(result.outboundFuelHeliox) && result.outboundFuelHeliox >= 0);
  assert.ok(Number.isSafeInteger(result.totalReservedFuelHeliox) && result.totalReservedFuelHeliox >= 0);
  expectCode('INVALID_FLEET_SPEED', () => plan({ fleetSpeed: 0 }));
});

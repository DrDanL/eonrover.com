import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLONIZATION_MAX_SLOT,
  COLONIZATION_SPEED_PERCENT,
  COLONY_STARTER_STATE,
  deriveColonyCharacteristics,
  PLANET_TYPES,
  planSameSystemColonization,
} from './index';

const origin = { galaxy: 3, system: 44, slot: 4 };

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    origin,
    targetSlot: 9,
    ships: { colonyShip: 1 },
    fleetSpeed: 1,
    ...overrides,
  };
}

test('same-system colonization fixes speed and derives a finite plan', () => {
  const plan = planSameSystemColonization(validInput());
  assert.deepEqual(plan.target, { galaxy: origin.galaxy, system: origin.system, slot: 9 });
  assert.deepEqual(plan.ships, { colonyShip: 1 });
  assert.equal(plan.speedPercent, COLONIZATION_SPEED_PERCENT);
  assert.ok(Number.isInteger(plan.durationSeconds) && plan.durationSeconds > 0);
  assert.ok(Number.isInteger(plan.fuelHeliox) && plan.fuelHeliox >= 0);
});

test('same-system colonization rejects invalid slots and an origin-slot target', () => {
  for (const targetSlot of [0, -1, 1.5, Infinity, origin.slot, COLONIZATION_MAX_SLOT + 1]) {
    assert.throws(() => planSameSystemColonization(validInput({ targetSlot })));
  }
});

test('same-system colonization rejects malformed manifests, escorts, cargo, recall, and caller-selected speed', () => {
  for (const input of [
    validInput({ ships: {} }),
    validInput({ ships: { colonyShip: 2 } }),
    validInput({ ships: { colonyShip: 1, scout: 1 } }),
    validInput({ ships: { scout: 1 } }),
    validInput({ escorts: { scout: 1 } }),
    validInput({ cargo: { alloy: 1 } }),
    validInput({ recall: true }),
    validInput({ speedPercent: 100 }),
    validInput({ targetGalaxy: 999, targetSystem: 999 }),
  ]) {
    assert.throws(() => planSameSystemColonization(input as ReturnType<typeof validInput>));
  }
});

test('colony characteristics are deterministic and stay in the selected profile ranges', () => {
  const missionId = '0db6897f-4206-4ae1-b685-8d34e7f6b4ee';
  const first = deriveColonyCharacteristics(missionId);
  const second = deriveColonyCharacteristics(missionId);
  assert.deepEqual(second, first);
  const profile = PLANET_TYPES[first.planetType];
  assert.ok(Number.isInteger(first.temperature));
  assert.ok(first.temperature >= profile.temperatureRange[0] && first.temperature <= profile.temperatureRange[1]);
  assert.ok(Number.isFinite(first.solarIndex));
  assert.ok(first.solarIndex >= profile.solarIndexRange[0] && first.solarIndex <= profile.solarIndexRange[1]);
  assert.equal(first.fieldCapacity, 180);
});

test('colony starter state is explicit and exact', () => {
  assert.deepEqual(COLONY_STARTER_STATE, {
    fieldCapacity: 180,
    resources: { alloy: 500, heliox: 300, aether: 0 },
    buildings: { solarArray: 1, alloyMine: 0, helioxExtractor: 0 },
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePlanetFields } from './planetFields';
import { evaluateBuildingPrerequisites } from './buildingPrerequisites';
import { DEFAULT_PLANET_FIELD_CAPACITY } from './planetFields';

test('calculates an empty planet and its next field projection', () => {
  assert.deepEqual(calculatePlanetFields({
    capacity: 180,
    buildingLevels: {},
    proposedBuildingKey: 'alloyMine',
  }), {
    capacity: 180,
    completedUsed: 0,
    reserved: 0,
    occupied: 0,
    available: 180,
    projectedOccupied: 1,
    projectedAvailable: 179,
    requiredForUpgrade: 1,
    isAtCapacity: false,
    isOverCapacity: false,
    canConstruct: true,
    shortfall: 0,
  });
});

test('sums normal completed usage and ignores level-zero buildings', () => {
  const fields = calculatePlanetFields({
    capacity: 20,
    buildingLevels: { alloyMine: 4, helioxExtractor: 3, solarArray: 0, researchLab: 2 },
    proposedBuildingKey: 'researchLab',
  });
  assert.equal(fields.completedUsed, 9);
  assert.equal(fields.occupied, 9);
  assert.equal(fields.available, 11);
});

test('counts one accepted pending construction as one reserved field', () => {
  const fields = calculatePlanetFields({
    capacity: 20,
    buildingLevels: { alloyMine: 4 },
    pendingConstructionCounts: { solarArray: 1 },
    proposedBuildingKey: 'alloyMine',
  });
  assert.equal(fields.completedUsed, 4);
  assert.equal(fields.reserved, 1);
  assert.equal(fields.occupied, 5);
});

test('allows an upgrade that reaches exact capacity', () => {
  const fields = calculatePlanetFields({
    capacity: 5,
    buildingLevels: { alloyMine: 4 },
    proposedBuildingKey: 'solarArray',
  });
  assert.equal(fields.projectedOccupied, 5);
  assert.equal(fields.projectedAvailable, 0);
  assert.equal(fields.canConstruct, true);
  assert.equal(fields.shortfall, 0);
});

test('reports a one-field shortfall beyond capacity', () => {
  const fields = calculatePlanetFields({
    capacity: 4,
    buildingLevels: { alloyMine: 4 },
    proposedBuildingKey: 'solarArray',
  });
  assert.equal(fields.available, 0);
  assert.equal(fields.projectedOccupied, 5);
  assert.equal(fields.canConstruct, false);
  assert.equal(fields.shortfall, 1);
});

test('cancellation releases a reservation without changing completed use', () => {
  const pending = calculatePlanetFields({
    capacity: 5,
    buildingLevels: { alloyMine: 4 },
    pendingConstructionCounts: { solarArray: 1 },
    proposedBuildingKey: 'solarArray',
  });
  const cancelled = calculatePlanetFields({
    capacity: 5,
    buildingLevels: { alloyMine: 4 },
    proposedBuildingKey: 'solarArray',
  });
  assert.equal(pending.reserved, 1);
  assert.equal(cancelled.reserved, 0);
  assert.equal(cancelled.available, pending.available + 1);
  assert.equal(cancelled.completedUsed, pending.completedUsed);
});

test('completion converts a reservation to completed use without double counting', () => {
  const pending = calculatePlanetFields({
    capacity: 5,
    buildingLevels: { alloyMine: 4 },
    pendingConstructionCounts: { solarArray: 1 },
    proposedBuildingKey: 'alloyMine',
  });
  const completed = calculatePlanetFields({
    capacity: 5,
    buildingLevels: { alloyMine: 4, solarArray: 1 },
    proposedBuildingKey: 'alloyMine',
  });
  assert.equal(pending.occupied, 5);
  assert.equal(completed.occupied, 5);
  assert.equal(completed.completedUsed, 5);
  assert.equal(completed.reserved, 0);
});

test('rejects negative, fractional, non-finite, and invalid reservation input', () => {
  const base = { capacity: 5, proposedBuildingKey: 'alloyMine' as const };
  assert.throws(() => calculatePlanetFields({ ...base, buildingLevels: { alloyMine: -1 } }), RangeError);
  assert.throws(() => calculatePlanetFields({ ...base, buildingLevels: { alloyMine: 0.5 } }), RangeError);
  assert.throws(() => calculatePlanetFields({ ...base, buildingLevels: { alloyMine: Number.NaN } }), RangeError);
  assert.throws(() => calculatePlanetFields({
    ...base,
    buildingLevels: {},
    pendingConstructionCounts: { solarArray: -1 },
  }), RangeError);
  assert.throws(() => calculatePlanetFields({ ...base, capacity: 0, buildingLevels: {} }), RangeError);
  assert.throws(() => calculatePlanetFields({ ...base, capacity: 2.5, buildingLevels: {} }), RangeError);
});

test('handles legacy over-capacity state with safe non-negative availability', () => {
  const fields = calculatePlanetFields({
    capacity: 3,
    buildingLevels: { alloyMine: 4, solarArray: 1 },
    pendingConstructionCounts: { helioxExtractor: 1 },
    proposedBuildingKey: 'alloyMine',
  });
  assert.equal(fields.completedUsed, 5);
  assert.equal(fields.reserved, 1);
  assert.equal(fields.occupied, 6);
  assert.equal(fields.available, 0);
  assert.equal(fields.projectedAvailable, 0);
  assert.equal(fields.isAtCapacity, false);
  assert.equal(fields.isOverCapacity, true);
  assert.equal(fields.canConstruct, false);
  assert.equal(fields.shortfall, 4);
});

test('returns deterministic results for identical input', () => {
  const input = {
    capacity: 180,
    buildingLevels: { alloyMine: 2, solarArray: 3 },
    pendingConstructionCounts: { researchLab: 1 },
    proposedBuildingKey: 'helioxExtractor' as const,
  };
  assert.deepEqual(calculatePlanetFields(input), calculatePlanetFields(input));
});

test('default capacity leaves substantial headroom after the minimum Gate Observatory prerequisite chain', () => {
  const minimumGateEligibilityLevels = {
    researchLab: 3,
    aetherSynthesizer: 2,
    solarArray: 4,
  };
  assert.equal(evaluateBuildingPrerequisites('gateObservatory', minimumGateEligibilityLevels)?.meetsPrerequisites, true);
  const fields = calculatePlanetFields({
    capacity: DEFAULT_PLANET_FIELD_CAPACITY,
    buildingLevels: minimumGateEligibilityLevels,
    proposedBuildingKey: 'gateObservatory',
  });
  assert.equal(fields.completedUsed, 9);
  assert.equal(fields.projectedOccupied, 10);
  assert.equal(fields.projectedAvailable, 170);
  assert.equal(fields.canConstruct, true);
});

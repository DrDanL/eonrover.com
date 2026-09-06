import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBuildingPrerequisites } from './buildingPrerequisites';

test('allows buildings with no prerequisites', () => {
  assert.deepEqual(evaluateBuildingPrerequisites('alloyMine', {}), {
    buildingId: 'alloyMine',
    requirements: [],
    unmetRequirements: [],
    meetsPrerequisites: true,
  });
});

test('reports one satisfied requirement', () => {
    const result = evaluateBuildingPrerequisites('alloyStorage', { alloyMine: 3 });

    assert.equal(result?.meetsPrerequisites, true);
    assert.deepEqual(result?.requirements, [
      { buildingId: 'alloyMine', requiredLevel: 2, currentLevel: 3, met: true },
    ]);
    assert.deepEqual(result?.unmetRequirements, []);
});

test('reports one unmet requirement', () => {
    const result = evaluateBuildingPrerequisites('helioxStorage', { helioxExtractor: 1 });

    assert.equal(result?.meetsPrerequisites, false);
    assert.deepEqual(result?.unmetRequirements, [
      { buildingId: 'helioxExtractor', requiredLevel: 2, currentLevel: 1, met: false },
    ]);
});

test('reports every requirement for a multi-requirement building', () => {
    const result = evaluateBuildingPrerequisites('shipyard', {
      alloyMine: 2,
      helioxExtractor: 0,
      solarArray: 1,
    });

    assert.equal(result?.requirements.length, 3);
    assert.equal(result?.unmetRequirements.length, 2);
    assert.equal(result?.meetsPrerequisites, false);
});

test('preserves deterministic definition order', () => {
    const result = evaluateBuildingPrerequisites('gateObservatory', {});

    assert.deepEqual(result?.requirements.map((requirement) => requirement.buildingId), [
      'researchLab',
      'aetherSynthesizer',
      'solarArray',
    ]);
    assert.deepEqual(result?.unmetRequirements.map((requirement) => requirement.buildingId), [
      'researchLab',
      'aetherSynthesizer',
      'solarArray',
    ]);
});

test('accepts a completed level exactly equal to the requirement', () => {
    assert.equal(evaluateBuildingPrerequisites('aetherStorage', { aetherSynthesizer: 2 })?.meetsPrerequisites, true);
});

test('does not count a pending prerequisite target as completed', () => {
    const completedLevels = { alloyMine: 1 };
    const pendingUpgrade = { buildingId: 'alloyMine', targetLevel: 2 };

    assert.equal(pendingUpgrade.targetLevel, 2);
    assert.equal(evaluateBuildingPrerequisites('alloyStorage', completedLevels)?.meetsPrerequisites, false);
});

test('rejects unknown building identifiers safely', () => {
    assert.equal(evaluateBuildingPrerequisites('unknown-building', {}), null);
    assert.equal(evaluateBuildingPrerequisites('toString', {}), null);
});

test('keeps a legacy building locked for further upgrades when prerequisites are unmet', () => {
    const legacyCompletedLevels = { researchLab: 2, aetherSynthesizer: 0, solarArray: 1 };
    const result = evaluateBuildingPrerequisites('researchLab', legacyCompletedLevels);

    assert.equal(result?.buildingId, 'researchLab');
    assert.equal(result?.meetsPrerequisites, false);
    assert.deepEqual(result?.unmetRequirements, [
      { buildingId: 'aetherSynthesizer', requiredLevel: 1, currentLevel: 0, met: false },
      { buildingId: 'solarArray', requiredLevel: 2, currentLevel: 1, met: false },
    ]);
});

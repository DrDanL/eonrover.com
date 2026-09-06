import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESEARCH_BY_ID,
  RESEARCH_CATALOGUE,
  RESEARCH_CATEGORIES,
  evaluateResearchEntry,
  researchCostForLevel,
  researchDurationForLevel,
} from './researchCatalogue';

test('research catalogue contains every persisted id exactly once in deterministic category order', () => {
  assert.deepEqual(RESEARCH_CATALOGUE.map((entry) => entry.id), [
    'alloyProcessing', 'helioxCombustion', 'aetherPhysics', 'propulsionTheory', 'espionageTech', 'shieldTech', 'weaponTech', 'armourTech', 'gateTheory',
  ]);
  assert.equal(new Set(RESEARCH_CATALOGUE.map((entry) => entry.id)).size, RESEARCH_CATALOGUE.length);
  assert.equal(new Set(RESEARCH_CATALOGUE.map((entry) => entry.displayOrder)).size, RESEARCH_CATALOGUE.length);
  assert.deepEqual(RESEARCH_CATEGORIES.map((category) => category.id), ['economy', 'science', 'propulsion', 'intelligence', 'combat', 'gate']);
  assert.deepEqual(Object.keys(RESEARCH_BY_ID), RESEARCH_CATALOGUE.map((entry) => entry.id));
});

test('research costs and duration preserve the prototype formula with level, lab and speed inputs', () => {
  assert.deepEqual(researchCostForLevel('alloyProcessing', 1), { alloy: 200, heliox: 100, aether: 0 });
  assert.deepEqual(researchCostForLevel('alloyProcessing', 2), { alloy: 320, heliox: 160, aether: 0 });
  assert.equal(researchDurationForLevel('alloyProcessing', 1, 0, 1), 1080);
  assert.equal(researchDurationForLevel('alloyProcessing', 1, 2, 2), 180);
});

test('research evaluation uses account-wide completed levels and selected-planet lab requirements', () => {
  const evaluation = evaluateResearchEntry({
    id: 'gateTheory',
    currentLevel: 2,
    accountResearchLevels: { aetherPhysics: 3 },
    planetBuildingLevels: { researchLab: 5, gateObservatory: 0 },
    researchSpeed: 1,
  });
  assert.equal(evaluation.currentLevel, 2);
  assert.equal(evaluation.nextLevel, 3);
  assert.equal(evaluation.requirements[0].met, true);
  assert.equal(evaluation.requirements[1].met, false);
  assert.equal(evaluation.unmetRequirements.length, 1);
  assert.equal(evaluation.meetsRequirements, false);
});

test('research evaluation fails safely closed for invalid numbers and exposes every effect status', () => {
  const evaluation = evaluateResearchEntry({
    id: 'espionageTech', currentLevel: Number.NaN, accountResearchLevels: {}, planetBuildingLevels: { researchLab: Number.POSITIVE_INFINITY }, researchSpeed: Number.NaN,
  });
  assert.equal(evaluation.currentLevel, 0);
  assert.equal(evaluation.researchLabLevel, 0);
  assert.ok(Number.isFinite(evaluation.durationSeconds));
  assert.deepEqual(new Set(RESEARCH_CATALOGUE.map((entry) => entry.effect.status)), new Set(['ACTIVE', 'PARTIAL', 'PLANNED']));
});

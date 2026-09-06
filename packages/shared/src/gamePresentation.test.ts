import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planetIdFromGamePath,
  planetSwitchPath,
  projectVisualResourceAmount,
  selectPlanetNextAction,
  timeUntilStorageFullSeconds,
} from './gamePresentation';

test('projects visual resource growth from an authoritative server timestamp', () => {
  assert.equal(projectVisualResourceAmount({
    amount: 100,
    hourlyRate: 60,
    capacity: 1_000,
    serverTimestampMs: 1_000,
    displayTimestampMs: 31_000,
  }), 100.5);
});

test('caps a visual resource projection at storage capacity', () => {
  assert.equal(projectVisualResourceAmount({
    amount: 995,
    hourlyRate: 60,
    capacity: 1_000,
    serverTimestampMs: 0,
    displayTimestampMs: 3_600_000,
  }), 1_000);
});

test('keeps a zero-production resource unchanged', () => {
  assert.equal(projectVisualResourceAmount({
    amount: 75,
    hourlyRate: 0,
    capacity: 100,
    serverTimestampMs: 0,
    displayTimestampMs: 3_600_000,
  }), 75);
});

test('calculates time until storage is full and handles full or idle storage', () => {
  assert.equal(timeUntilStorageFullSeconds(700, 100, 1_000), 10_800);
  assert.equal(timeUntilStorageFullSeconds(1_000, 100, 1_000), 0);
  assert.equal(timeUntilStorageFullSeconds(700, 0, 1_000), null);
});

test('selects the deterministic first missing resource building', () => {
  const action = selectPlanetNextAction({
    activeConstruction: null,
    energyStatus: 'healthy',
    energyBlockedBuildingKeys: [],
    buildingLevels: { alloyMine: 1, helioxExtractor: 0, aetherSynthesizer: 0 },
  });
  assert.equal(action.kind, 'heliox');
  assert.equal(action.buildingKey, 'helioxExtractor');
});

test('prioritises an energy-deficit recommendation', () => {
  const action = selectPlanetNextAction({
    activeConstruction: null,
    energyStatus: 'deficit',
    energyBlockedBuildingKeys: [],
    buildingLevels: {},
  });
  assert.equal(action.kind, 'energy');
  assert.equal(action.buildingKey, 'solarArray');
});

test('prioritises active construction above every other recommendation', () => {
  const action = selectPlanetNextAction({
    activeConstruction: { buildingName: 'Solar Array', targetLevel: 2 },
    energyStatus: 'deficit',
    energyBlockedBuildingKeys: ['alloyMine'],
    buildingLevels: {},
  });
  assert.equal(action.kind, 'construction');
  assert.match(action.title, /Solar Array level 2/);
});

test('preserves supported planet sections and otherwise returns to overview', () => {
  assert.equal(planetIdFromGamePath('/game/planets/old/buildings'), 'old');
  assert.equal(planetSwitchPath('/game/planets/old/buildings', 'old', 'next'), '/game/planets/next/buildings');
  assert.equal(planetSwitchPath('/game/galaxy', 'old', 'next'), '/game/planets/next');
  assert.equal(planetSwitchPath('/game/planets/stale/buildings', 'old', 'next'), '/game/planets/next');
});

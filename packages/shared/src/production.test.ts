import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePlanetProduction, PlanetProductionInput } from './formulas';

const START = new Date('2026-01-01T00:00:00.000Z');
const HOUR_LATER = new Date('2026-01-01T01:00:00.000Z');

function productionInput(overrides: Partial<PlanetProductionInput> = {}): PlanetProductionInput {
  return {
    previousProductionAt: START,
    currentTime: HOUR_LATER,
    resources: { alloy: 100, heliox: 100, aether: 7 },
    buildingLevels: { alloyMine: 1, helioxExtractor: 1, aetherSynthesizer: 0 },
    environment: { type: 'temperate', temperature: 10, solarIndex: 0.7 },
    storage: { alloy: 10_000, heliox: 10_000, aether: 10_000 },
    energySupply: 100,
    energyDemand: 22,
    economySpeed: 1,
    productionModifier: 1,
    ...overrides,
  };
}

function assertClose(actual: number, expected: number, tolerance = 1e-10): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('planet production awards nothing for zero elapsed time', () => {
  const result = calculatePlanetProduction(productionInput({ currentTime: START }));

  assert.deepEqual(result.resources, { alloy: 100, heliox: 100, aether: 7 });
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.lastProductionAt.getTime(), START.getTime());
});

test('planet production calculates one normal hour from existing balance', () => {
  const result = calculatePlanetProduction(productionInput());

  assert.equal(result.resources.alloy, 133);
  assert.equal(result.resources.heliox, 122);
  assert.equal(result.resources.aether, 7);
  assert.equal(result.lastProductionAt.getTime(), HOUR_LATER.getTime());
});

test('planet production calculates multiple offline hours', () => {
  const result = calculatePlanetProduction(
    productionInput({ currentTime: new Date('2026-01-01T03:00:00.000Z') }),
  );

  assertClose(result.resources.alloy, 199);
  assertClose(result.resources.heliox, 166);
});

test('economy speed is applied exactly once', () => {
  const normal = calculatePlanetProduction(productionInput());
  const doubled = calculatePlanetProduction(productionInput({ economySpeed: 2 }));

  assertClose(doubled.resources.alloy - 100, (normal.resources.alloy - 100) * 2);
  assertClose(doubled.resources.heliox - 100, (normal.resources.heliox - 100) * 2);
});

test('full energy preserves production and an energy shortage reduces it proportionally', () => {
  const full = calculatePlanetProduction(productionInput({ energySupply: 22, energyDemand: 22 }));
  const reduced = calculatePlanetProduction(productionInput({ energySupply: 11, energyDemand: 22 }));

  assert.equal(full.energyEfficiency, 1);
  assert.equal(reduced.energyEfficiency, 0.5);
  assertClose(reduced.resources.alloy, 116.5);
  assertClose(reduced.resources.heliox, 111);
});

test('storage capacity bounds production', () => {
  const result = calculatePlanetProduction(
    productionInput({ storage: { alloy: 120, heliox: 115, aether: 10_000 } }),
  );

  assert.equal(result.resources.alloy, 120);
  assert.equal(result.resources.heliox, 115);
});

test('one capped resource does not stop another resource producing', () => {
  const result = calculatePlanetProduction(
    productionInput({ storage: { alloy: 100, heliox: 10_000, aether: 10_000 } }),
  );

  assert.equal(result.resources.alloy, 100);
  assert.equal(result.resources.heliox, 122);
});

test('a resource whose building has zero production remains unchanged', () => {
  const result = calculatePlanetProduction(
    productionInput({ currentTime: new Date('2026-01-02T01:00:00.000Z') }),
  );

  assert.equal(result.hourlyRates.aether, 0);
  assert.equal(result.resources.aether, 7);
});

test('a future stored timestamp produces nothing and is not moved', () => {
  const future = new Date('2026-01-01T02:00:00.000Z');
  const result = calculatePlanetProduction(productionInput({ previousProductionAt: future }));

  assert.deepEqual(result.resources, { alloy: 100, heliox: 100, aether: 7 });
  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.lastProductionAt.getTime(), future.getTime());
});

test('a very long offline interval remains bounded by storage', () => {
  const result = calculatePlanetProduction(
    productionInput({
      currentTime: new Date('2036-01-01T00:00:00.000Z'),
      resources: { alloy: 0, heliox: 0, aether: 0 },
      buildingLevels: { alloyMine: 1, helioxExtractor: 1, aetherSynthesizer: 1 },
      storage: { alloy: 500, heliox: 400, aether: 300 },
      energySupply: 100,
      energyDemand: 40,
    }),
  );

  assert.deepEqual(result.resources, { alloy: 500, heliox: 400, aether: 300 });
});

test('invalid numeric inputs cannot produce a persistable result', () => {
  assert.throws(
    () => calculatePlanetProduction(productionInput({ resources: { alloy: Number.NaN, heliox: 0, aether: 0 } })),
    /finite number/,
  );
  assert.throws(() => calculatePlanetProduction(productionInput({ economySpeed: Number.POSITIVE_INFINITY })), /finite number/);
});

test('synchronisation clamps negative balances instead of preserving them', () => {
  const result = calculatePlanetProduction(
    productionInput({
      currentTime: START,
      resources: { alloy: -5, heliox: -1, aether: -10 },
    }),
  );

  assert.deepEqual(result.resources, { alloy: 0, heliox: 0, aether: 0 });
});

test('twelve five-minute synchronisations equal one combined hour', () => {
  let resources = productionInput().resources;
  let previousProductionAt = START;

  for (let interval = 1; interval <= 12; interval += 1) {
    const currentTime = new Date(START.getTime() + interval * 5 * 60 * 1000);
    const result = calculatePlanetProduction(
      productionInput({ previousProductionAt, currentTime, resources }),
    );
    resources = result.resources;
    previousProductionAt = result.lastProductionAt;
  }

  const combined = calculatePlanetProduction(productionInput());
  assertClose(resources.alloy, combined.resources.alloy);
  assertClose(resources.heliox, combined.resources.heliox);
  assertClose(resources.aether, combined.resources.aether);
});

test('fractional production is retained without refresh-frequency rounding', () => {
  const base = productionInput({
    resources: { alloy: 0, heliox: 0, aether: 0 },
    buildingLevels: { alloyMine: 3, helioxExtractor: 2, aetherSynthesizer: 1 },
    environment: { type: 'volcanic', temperature: 45, solarIndex: 0.9 },
    energySupply: 200,
    energyDemand: 72,
  });
  let resources = base.resources;
  let previousProductionAt = START;

  for (let minute = 1; minute <= 60; minute += 1) {
    const result = calculatePlanetProduction({
      ...base,
      previousProductionAt,
      currentTime: new Date(START.getTime() + minute * 60 * 1000),
      resources,
    });
    resources = result.resources;
    previousProductionAt = result.lastProductionAt;
  }

  const combined = calculatePlanetProduction(base);
  assertClose(resources.alloy, combined.resources.alloy, 1e-9);
  assertClose(resources.heliox, combined.resources.heliox, 1e-9);
  assertClose(resources.aether, combined.resources.aether, 1e-9);
  assert.notEqual(resources.aether, Math.round(resources.aether));
});

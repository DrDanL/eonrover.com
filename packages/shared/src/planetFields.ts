import { BUILDINGS, DEFAULT_PLANET_FIELD_CAPACITY } from './constants';
import { BuildingKey } from './types';

export { DEFAULT_PLANET_FIELD_CAPACITY };

export interface PlanetFieldCalculationInput {
  capacity: number;
  buildingLevels: Partial<Record<BuildingKey, number>>;
  pendingConstructionCounts?: Partial<Record<BuildingKey, number>>;
  proposedBuildingKey: BuildingKey;
}

export interface PlanetFieldCalculation {
  capacity: number;
  completedUsed: number;
  reserved: number;
  occupied: number;
  available: number;
  projectedOccupied: number;
  projectedAvailable: number;
  requiredForUpgrade: number;
  isAtCapacity: boolean;
  isOverCapacity: boolean;
  canConstruct: boolean;
  shortfall: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function weightedTotal(
  values: Partial<Record<BuildingKey, number>>,
  label: string,
): number {
  let total = 0;
  for (const [rawKey, value] of Object.entries(values)) {
    if (!(rawKey in BUILDINGS)) throw new RangeError(`${label} contains an unknown building key`);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must contain non-negative integers`);
    }
    total += value * BUILDINGS[rawKey as BuildingKey].fieldCost;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError(`${label} total must be a safe integer`);
  return total;
}

export function calculatePlanetFields(input: PlanetFieldCalculationInput): PlanetFieldCalculation {
  assertPositiveInteger(input.capacity, 'Planet field capacity');
  if (!(input.proposedBuildingKey in BUILDINGS)) {
    throw new RangeError('Proposed upgrade contains an unknown building key');
  }

  const completedUsed = weightedTotal(input.buildingLevels, 'Building levels');
  const reserved = weightedTotal(input.pendingConstructionCounts ?? {}, 'Pending construction counts');
  const requiredForUpgrade = BUILDINGS[input.proposedBuildingKey].fieldCost;
  assertPositiveInteger(requiredForUpgrade, 'Building field cost');

  const occupied = completedUsed + reserved;
  const projectedOccupied = occupied + requiredForUpgrade;
  if (![occupied, projectedOccupied].every(Number.isSafeInteger)) {
    throw new RangeError('Planet field results must be safe integers');
  }
  const available = Math.max(0, input.capacity - occupied);
  const projectedAvailable = Math.max(0, input.capacity - projectedOccupied);
  const shortfall = Math.max(0, projectedOccupied - input.capacity);

  return {
    capacity: input.capacity,
    completedUsed,
    reserved,
    occupied,
    available,
    projectedOccupied,
    projectedAvailable,
    requiredForUpgrade,
    isAtCapacity: occupied === input.capacity,
    isOverCapacity: occupied > input.capacity,
    canConstruct: projectedOccupied <= input.capacity,
    shortfall,
  };
}

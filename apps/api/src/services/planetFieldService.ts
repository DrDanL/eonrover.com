import { BuildingKey, calculatePlanetFields } from '@eonrover/shared';

export interface BuildingLevelRow {
  key: string;
  level: number;
}

export interface PendingBuildingRow {
  buildingKey: string;
}

export function buildingLevelRecord(rows: BuildingLevelRow[]): Partial<Record<BuildingKey, number>> {
  return Object.fromEntries(rows.map((row) => [row.key, row.level])) as Partial<Record<BuildingKey, number>>;
}

export function pendingFieldReservationCounts(
  rows: PendingBuildingRow[],
): Partial<Record<BuildingKey, number>> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.buildingKey] = (counts[row.buildingKey] ?? 0) + 1;
  return counts as Partial<Record<BuildingKey, number>>;
}

export function presentPlanetFieldSummary(fields: ReturnType<typeof calculatePlanetFields>) {
  return {
    capacity: fields.capacity,
    completedUsed: fields.completedUsed,
    reserved: fields.reserved,
    occupied: fields.occupied,
    available: fields.available,
    isAtCapacity: fields.isAtCapacity,
    isOverCapacity: fields.isOverCapacity,
    overCapacityBy: Math.max(0, fields.occupied - fields.capacity),
  };
}

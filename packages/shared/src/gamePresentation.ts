import { BuildingKey } from './types';

export interface VisualResourceProjection {
  amount: number;
  hourlyRate: number;
  capacity: number;
  serverTimestampMs: number;
  displayTimestampMs: number;
}

export function projectVisualResourceAmount(input: VisualResourceProjection): number {
  const values = Object.values(input);
  if (!values.every(Number.isFinite)) throw new RangeError('Resource projection values must be finite');
  if (input.hourlyRate < 0 || input.capacity < 0) {
    throw new RangeError('Resource rate and capacity cannot be negative');
  }
  const current = Math.min(input.capacity, Math.max(0, input.amount));
  const elapsedSeconds = Math.max(0, (input.displayTimestampMs - input.serverTimestampMs) / 1000);
  return Math.min(input.capacity, current + (input.hourlyRate * elapsedSeconds) / 3600);
}

export function timeUntilStorageFullSeconds(amount: number, hourlyRate: number, capacity: number): number | null {
  if (![amount, hourlyRate, capacity].every(Number.isFinite)) {
    throw new RangeError('Storage timing values must be finite');
  }
  if (hourlyRate < 0 || capacity < 0) throw new RangeError('Resource rate and capacity cannot be negative');
  if (amount >= capacity) return 0;
  if (hourlyRate === 0) return null;
  return (Math.max(0, capacity - amount) / hourlyRate) * 3600;
}

export interface PlanetNextActionInput {
  activeConstruction: { buildingName: string; targetLevel: number } | null;
  fields: { available: number; isOverCapacity: boolean };
  energyStatus: 'healthy' | 'approaching' | 'at-capacity' | 'deficit';
  energyBlockedBuildingKeys: BuildingKey[];
  buildingLevels: Partial<Record<BuildingKey, number>>;
}

export interface PlanetNextAction {
  kind: 'construction' | 'fields' | 'energy' | 'alloy' | 'heliox' | 'aether' | 'buildings';
  title: string;
  reason: string;
  buildingKey?: BuildingKey;
}

export function selectPlanetNextAction(input: PlanetNextActionInput): PlanetNextAction {
  if (input.activeConstruction) {
    return {
      kind: 'construction',
      title: `${input.activeConstruction.buildingName} level ${input.activeConstruction.targetLevel} is underway`,
      reason: 'Monitor the authoritative construction timer before planning the next upgrade.',
    };
  }
  if (input.fields.available === 0) {
    return {
      kind: 'fields',
      title: input.fields.isOverCapacity ? 'Planet is over field capacity' : 'Planetary field capacity reached',
      reason: input.fields.isOverCapacity
        ? 'Completed facilities exceed this planet’s configured capacity. Existing buildings remain operational, but no new upgrade can begin.'
        : 'Every planetary building field is occupied. No additional building upgrade can begin.',
    };
  }
  if (input.energyStatus === 'deficit' || input.energyBlockedBuildingKeys.length > 0) {
    return {
      kind: 'energy',
      title: 'Review Solar Array capacity',
      reason:
        input.energyStatus === 'deficit'
          ? 'The grid is in deficit and resource production is operating below full efficiency.'
          : 'At least one available resource-building upgrade would exceed current grid capacity.',
      buildingKey: 'solarArray',
    };
  }
  const firstResourceBuilding = [
    ['alloyMine', 'Commission the first Alloy Mine', 'Alloy supports every early colony upgrade.'],
    ['helioxExtractor', 'Commission the first Heliox Extractor', 'Heliox is needed for energy and propulsion infrastructure.'],
    ['aetherSynthesizer', 'Review the first Aether Synthesizer', 'Aether supports advanced development once its prerequisites are met.'],
  ] as const;
  for (const [buildingKey, title, reason] of firstResourceBuilding) {
    if ((input.buildingLevels[buildingKey] ?? 0) === 0) {
      return { kind: buildingKey === 'alloyMine' ? 'alloy' : buildingKey === 'helioxExtractor' ? 'heliox' : 'aether', title, reason, buildingKey };
    }
  }
  return {
    kind: 'buildings',
    title: 'Review available building upgrades',
    reason: 'Core resource production is online; compare the next authoritative costs and capacity requirements.',
  };
}

const PLANET_ROUTE = /^\/game\/planets\/([^/]+)(\/(?:buildings|research|shipyard|fleet))?\/?$/;

export function planetIdFromGamePath(pathname: string): string | null {
  return PLANET_ROUTE.exec(pathname)?.[1] ?? null;
}

export function planetSwitchPath(pathname: string, currentPlanetId: string, nextPlanetId: string): string {
  const match = PLANET_ROUTE.exec(pathname);
  if (!match || match[1] !== currentPlanetId) return `/game/planets/${nextPlanetId}`;
  return `/game/planets/${nextPlanetId}${match[2] ?? ''}`;
}

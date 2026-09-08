import { DEFAULT_PLANET_FIELD_CAPACITY } from './constants';
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
export declare function calculatePlanetFields(input: PlanetFieldCalculationInput): PlanetFieldCalculation;

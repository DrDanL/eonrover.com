import { BuildingKey } from './types';
export interface VisualResourceProjection {
    amount: number;
    hourlyRate: number;
    capacity: number;
    serverTimestampMs: number;
    displayTimestampMs: number;
}
export declare function projectVisualResourceAmount(input: VisualResourceProjection): number;
export declare function timeUntilStorageFullSeconds(amount: number, hourlyRate: number, capacity: number): number | null;
export interface PlanetNextActionInput {
    activeConstruction: {
        buildingName: string;
        targetLevel: number;
    } | null;
    fields: {
        available: number;
        isOverCapacity: boolean;
    };
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
export declare function selectPlanetNextAction(input: PlanetNextActionInput): PlanetNextAction;
export declare function planetIdFromGamePath(pathname: string): string | null;
export declare function planetSwitchPath(pathname: string, currentPlanetId: string, nextPlanetId: string): string;

import { BuildingCategory, BuildingKey, DefenceKey, PlanetType, ResearchKey, ResourceAmounts, ShipKey } from './types';
export declare const BUILDING_CATEGORIES: ReadonlyArray<{
    key: BuildingCategory;
    label: string;
    description: string;
}>;
/**
 * Base definitions for buildings. Costs are for level 1 -> the formulas in
 * `formulas.ts` scale these up using an exponential growth factor per level.
 */
export interface BuildingDefinition {
    key: BuildingKey;
    name: string;
    category: BuildingCategory;
    description: string;
    baseCost: ResourceAmounts;
    costGrowth: number;
    /** base energy consumed (positive) or produced (negative) at level 1 */
    baseEnergy: number;
    /** planetary fields occupied by each completed or pending level */
    fieldCost: number;
    producesResource?: 'alloy' | 'heliox' | 'aether';
}
export declare const BUILDINGS: Record<BuildingKey, BuildingDefinition>;
export interface ResearchDefinition {
    key: ResearchKey;
    name: string;
    description: string;
    baseCost: ResourceAmounts;
    costGrowth: number;
    requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
}
/** @deprecated Use RESEARCH_CATALOGUE/RESEARCH_BY_ID for new code. */
export declare const RESEARCH: Record<ResearchKey, ResearchDefinition>;
export interface ShipDefinition {
    key: ShipKey;
    name: string;
    description: string;
    cost: ResourceAmounts;
    buildTimeSeconds: number;
    speed: number;
    cargo: number;
    fuelPerDistance: number;
    attack: number;
    shield: number;
    armour: number;
    requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
}
export declare const SHIPS: Record<ShipKey, ShipDefinition>;
export declare const DEFENCES: Record<DefenceKey, {
    key: DefenceKey;
    name: string;
    cost: ResourceAmounts;
    buildTimeSeconds: number;
    attack: number;
    shield: number;
    armour: number;
    requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
}>;
export interface PlanetTypeProfile {
    type: PlanetType;
    temperatureRange: [number, number];
    solarIndexRange: [number, number];
    productionMultiplier: Record<'alloy' | 'heliox' | 'aether', number>;
}
/** Governs how planet type/temperature affects production and colonisation. */
export declare const PLANET_TYPES: Record<PlanetType, PlanetTypeProfile>;
export interface UniverseConfig {
    universeSpeed: number;
    economySpeed: number;
    fleetSpeed: number;
    researchSpeed: number;
    newPlayerProtectionHours: number;
    maxPlanetsPerPlayer: number;
}
export declare const DEFAULT_UNIVERSE_CONFIG: UniverseConfig;
export declare const STARTING_RESOURCES: ResourceAmounts;
export declare const BASE_STORAGE_CAPACITY = 10000;
export declare const BASE_ENERGY_SUPPLY = 20;
export declare const GATE_ACTIVATION_FRAGMENTS = 3;
export declare const GATE_TRAVEL_SECONDS = 15;
export declare const GATE_ACTIVATION_REQUIREMENTS: {
    readonly gateObservatory: 1;
    readonly gateTheory: 1;
};

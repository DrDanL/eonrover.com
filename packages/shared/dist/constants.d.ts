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
/**
 * The bounded coordinate space used by homeworld allocation and public Galaxy
 * browsing. Mission-specific services must resolve any target server-side;
 * these bounds are not a client target-selection contract.
 */
export declare const GALAXY_COORDINATE_BOUNDS: Readonly<{
    galaxy: Readonly<{
        min: 1;
        max: 6;
    }>;
    system: Readonly<{
        min: 1;
        max: 400;
    }>;
    slot: Readonly<{
        min: 1;
        max: 12;
    }>;
}>;
export declare const STARTING_RESOURCES: ResourceAmounts;
export declare const BASE_STORAGE_CAPACITY = 10000;
export declare const BASE_ENERGY_SUPPLY = 20;
export declare const DEFAULT_PLANET_FIELD_CAPACITY = 180;
/**
 * The explicit starter state for a newly founded colony. Registration uses
 * the same state today, preserving its existing homeworld provisioning
 * behaviour while keeping future colony creation server-defined.
 */
export declare const COLONY_STARTER_STATE: {
    readonly fieldCapacity: 180;
    readonly resources: ResourceAmounts;
    readonly buildings: {
        readonly solarArray: 1;
        readonly alloyMine: 0;
        readonly helioxExtractor: 0;
    };
};
export declare const GATE_ACTIVATION_FRAGMENTS = 3;
export declare const GATE_TRAVEL_SECONDS = 15;
export declare const GATE_ACTIVATION_REQUIREMENTS: {
    readonly gateObservatory: 1;
    readonly gateTheory: 1;
};

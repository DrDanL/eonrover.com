import { ResourceAmounts, ShipKey } from './types';
export type ShipyardCategory = 'civilian' | 'combat' | 'specialist';
export type ShipyardEffectStatus = 'ACTIVE' | 'PARTIAL' | 'PLANNED';
export interface ShipyardCatalogueEntry {
    id: ShipKey;
    category: ShipyardCategory;
    displayOrder: number;
    missions: readonly string[];
    effect: {
        description: string;
        status: ShipyardEffectStatus;
    };
}
export declare const SHIPYARD_CATEGORIES: readonly [{
    readonly id: "civilian";
    readonly name: "Civilian";
    readonly displayOrder: 10;
}, {
    readonly id: "combat";
    readonly name: "Combat";
    readonly displayOrder: 20;
}, {
    readonly id: "specialist";
    readonly name: "Specialist";
    readonly displayOrder: 30;
}];
/** Presentation and availability metadata for every key that may be persisted in Ship. */
export declare const SHIPYARD_CATALOGUE: readonly ShipyardCatalogueEntry[];
export declare const SHIPYARD_BY_ID: Readonly<Record<ShipKey, ShipyardCatalogueEntry>>;
export declare function shipyardDurationForCatalogue(baseSeconds: number, shipyardLevel: number, economySpeed: number): number;
export declare function evaluateShipyardCatalogue(input: {
    id: ShipKey;
    shipyardLevel: number;
    economySpeed: number;
    buildingLevels: Record<string, number>;
    researchLevels: Record<string, number>;
}): {
    key: ShipKey;
    name: string;
    description: string;
    cost: ResourceAmounts;
    durationSeconds: number;
    statistics: {
        cargo: number;
        speed: number;
        fuelPerDistance: number;
        attack: number;
        shield: number;
        armour: number;
    };
    requirements: {
        id: string;
        requiredLevel: number;
        currentLevel: number;
        met: boolean;
        type: "building" | "research";
    }[];
    meetsRequirements: boolean;
    id: ShipKey;
    category: ShipyardCategory;
    displayOrder: number;
    missions: readonly string[];
    effect: {
        description: string;
        status: ShipyardEffectStatus;
    };
};

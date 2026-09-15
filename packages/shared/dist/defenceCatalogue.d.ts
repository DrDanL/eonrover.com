import { BuildingKey, DefenceKey, ResearchKey, ResourceAmounts } from './types';
export type DefenceAvailability = 'ACTIVE' | 'COMING_LATER';
export interface DefenceCatalogueEntry {
    id: DefenceKey;
    displayOrder: number;
    availability: DefenceAvailability;
    availabilityMessage: string;
}
/**
 * The defence catalogue is deliberately separate from ships.  It provides the
 * sole allowlisted source for a future defence presentation and construction
 * command. Shipyard activation stays deliberately allowlisted.
 */
export declare const DEFENCE_CATALOGUE: readonly DefenceCatalogueEntry[];
export declare const DEFENCE_BY_ID: Readonly<Record<DefenceKey, DefenceCatalogueEntry>>;
export declare const ACTIVE_SHIPYARD_DEFENCE_KEYS: readonly ["flakTurret", "railBattery"];
export type ActiveShipyardDefenceKey = (typeof ACTIVE_SHIPYARD_DEFENCE_KEYS)[number];
export declare function isActiveShipyardDefenceKey(value: unknown): value is ActiveShipyardDefenceKey;
export declare function evaluateDefenceCatalogue(input: {
    id: DefenceKey;
    shipyardLevel: number;
    economySpeed: number;
    buildingLevels: Record<string, number>;
    researchLevels: Record<string, number>;
    durationForBaseSeconds: (baseSeconds: number, shipyardLevel: number, economySpeed: number) => number;
}): {
    key: DefenceKey;
    name: string;
    cost: ResourceAmounts;
    durationSeconds: number;
    statistics: {
        attack: number;
        shield: number;
        armour: number;
    };
    requirements: {
        id: BuildingKey | ResearchKey;
        requiredLevel: number;
        currentLevel: number;
        met: boolean;
        type: "building" | "research";
    }[];
    meetsRequirements: boolean;
    id: DefenceKey;
    displayOrder: number;
    availability: DefenceAvailability;
    availabilityMessage: string;
};

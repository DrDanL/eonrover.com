import { BuildingKey, ResearchKey, ResourceAmounts } from './types';
export type ResearchCategory = 'economy' | 'science' | 'propulsion' | 'intelligence' | 'combat' | 'gate';
export type ResearchEffectStatus = 'ACTIVE' | 'PARTIAL' | 'PLANNED';
export type ResearchRequirement = {
    kind: 'building';
    id: BuildingKey;
    level: number;
} | {
    kind: 'research';
    id: ResearchKey;
    level: number;
};
export interface ResearchCatalogueEntry {
    /** Stable persisted value stored in Research.key and ResearchQueueItem.researchKey. */
    id: ResearchKey;
    name: string;
    description: string;
    category: ResearchCategory;
    displayOrder: number;
    baseCost: ResourceAmounts;
    costGrowth: number;
    requirements: readonly ResearchRequirement[];
    effect: {
        description: string;
        status: ResearchEffectStatus;
    };
}
export declare const RESEARCH_CATEGORIES: ReadonlyArray<{
    id: ResearchCategory;
    name: string;
    displayOrder: number;
}>;
/**
 * The authoritative, display-ordered catalogue for every research id that has
 * ever been persisted by the prototype. Keep ids stable: they are database
 * values, not presentation labels.
 */
export declare const RESEARCH_CATALOGUE: readonly ResearchCatalogueEntry[];
export declare const RESEARCH_BY_ID: Readonly<Record<ResearchKey, ResearchCatalogueEntry>>;
export declare function researchCostForLevel(id: ResearchKey, targetLevel: number): ResourceAmounts;
export declare function researchDurationForLevel(id: ResearchKey, targetLevel: number, researchLabLevel: number, researchSpeed: number): number;
export interface ResearchEvaluationInput {
    id: ResearchKey;
    currentLevel: number;
    accountResearchLevels: Readonly<Record<string, number>>;
    planetBuildingLevels: Readonly<Record<string, number>>;
    researchSpeed: number;
}
export declare function evaluateResearchEntry(input: ResearchEvaluationInput): {
    id: ResearchKey;
    currentLevel: number;
    nextLevel: number;
    cost: ResourceAmounts;
    durationSeconds: number;
    researchLabLevel: number;
    requirements: ({
        currentLevel: number;
        met: boolean;
        kind: "building";
        id: BuildingKey;
        level: number;
    } | {
        currentLevel: number;
        met: boolean;
        kind: "research";
        id: ResearchKey;
        level: number;
    })[];
    unmetRequirements: ({
        currentLevel: number;
        met: boolean;
        kind: "building";
        id: BuildingKey;
        level: number;
    } | {
        currentLevel: number;
        met: boolean;
        kind: "research";
        id: ResearchKey;
        level: number;
    })[];
    meetsRequirements: boolean;
};

import type { BuildingKey } from './types';
export interface BuildingPrerequisiteDefinition {
    buildingId: BuildingKey;
    requiredLevel: number;
}
export interface EvaluatedBuildingPrerequisite extends BuildingPrerequisiteDefinition {
    currentLevel: number;
    met: boolean;
}
export interface BuildingPrerequisiteEvaluation {
    buildingId: BuildingKey;
    requirements: EvaluatedBuildingPrerequisite[];
    unmetRequirements: EvaluatedBuildingPrerequisite[];
    meetsPrerequisites: boolean;
}
export declare const BUILDING_PREREQUISITES: {
    readonly alloyMine: readonly [];
    readonly helioxExtractor: readonly [];
    readonly aetherSynthesizer: readonly [];
    readonly solarArray: readonly [];
    readonly alloyStorage: readonly [{
        readonly buildingId: "alloyMine";
        readonly requiredLevel: 2;
    }];
    readonly helioxStorage: readonly [{
        readonly buildingId: "helioxExtractor";
        readonly requiredLevel: 2;
    }];
    readonly aetherStorage: readonly [{
        readonly buildingId: "aetherSynthesizer";
        readonly requiredLevel: 2;
    }];
    readonly researchLab: readonly [{
        readonly buildingId: "aetherSynthesizer";
        readonly requiredLevel: 1;
    }, {
        readonly buildingId: "solarArray";
        readonly requiredLevel: 2;
    }];
    readonly shipyard: readonly [{
        readonly buildingId: "alloyMine";
        readonly requiredLevel: 2;
    }, {
        readonly buildingId: "helioxExtractor";
        readonly requiredLevel: 1;
    }, {
        readonly buildingId: "solarArray";
        readonly requiredLevel: 2;
    }];
    readonly gateObservatory: readonly [{
        readonly buildingId: "researchLab";
        readonly requiredLevel: 3;
    }, {
        readonly buildingId: "aetherSynthesizer";
        readonly requiredLevel: 2;
    }, {
        readonly buildingId: "solarArray";
        readonly requiredLevel: 4;
    }];
};
export declare function evaluateBuildingPrerequisites(buildingId: string, completedBuildingLevels: Partial<Record<BuildingKey, number>>): BuildingPrerequisiteEvaluation | null;

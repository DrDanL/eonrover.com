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

export const BUILDING_PREREQUISITES = {
  alloyMine: [],
  helioxExtractor: [],
  aetherSynthesizer: [],
  solarArray: [],
  alloyStorage: [{ buildingId: 'alloyMine', requiredLevel: 2 }],
  helioxStorage: [{ buildingId: 'helioxExtractor', requiredLevel: 2 }],
  aetherStorage: [{ buildingId: 'aetherSynthesizer', requiredLevel: 2 }],
  researchLab: [
    { buildingId: 'aetherSynthesizer', requiredLevel: 1 },
    { buildingId: 'solarArray', requiredLevel: 2 },
  ],
  shipyard: [
    { buildingId: 'alloyMine', requiredLevel: 2 },
    { buildingId: 'helioxExtractor', requiredLevel: 1 },
    { buildingId: 'solarArray', requiredLevel: 2 },
  ],
  gateObservatory: [
    { buildingId: 'researchLab', requiredLevel: 3 },
    { buildingId: 'aetherSynthesizer', requiredLevel: 2 },
    { buildingId: 'solarArray', requiredLevel: 4 },
  ],
} as const satisfies Readonly<Record<BuildingKey, readonly BuildingPrerequisiteDefinition[]>>;

function isBuildingKey(value: string): value is BuildingKey {
  return Object.prototype.hasOwnProperty.call(BUILDING_PREREQUISITES, value);
}

function completedLevel(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function evaluateBuildingPrerequisites(
  buildingId: string,
  completedBuildingLevels: Partial<Record<BuildingKey, number>>,
): BuildingPrerequisiteEvaluation | null {
  if (!isBuildingKey(buildingId)) return null;

  const requirements = BUILDING_PREREQUISITES[buildingId].map((requirement) => {
    const currentLevel = completedLevel(completedBuildingLevels[requirement.buildingId]);
    return {
      buildingId: requirement.buildingId,
      requiredLevel: requirement.requiredLevel,
      currentLevel,
      met: currentLevel >= requirement.requiredLevel,
    };
  });
  const unmetRequirements = requirements.filter((requirement) => !requirement.met);

  return {
    buildingId,
    requirements,
    unmetRequirements,
    meetsPrerequisites: unmetRequirements.length === 0,
  };
}

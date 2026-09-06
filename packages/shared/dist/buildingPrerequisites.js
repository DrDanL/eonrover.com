"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILDING_PREREQUISITES = void 0;
exports.evaluateBuildingPrerequisites = evaluateBuildingPrerequisites;
exports.BUILDING_PREREQUISITES = {
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
};
function isBuildingKey(value) {
    return Object.prototype.hasOwnProperty.call(exports.BUILDING_PREREQUISITES, value);
}
function completedLevel(value) {
    return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
function evaluateBuildingPrerequisites(buildingId, completedBuildingLevels) {
    if (!isBuildingKey(buildingId))
        return null;
    const requirements = exports.BUILDING_PREREQUISITES[buildingId].map((requirement) => {
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

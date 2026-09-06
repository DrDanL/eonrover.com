"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESEARCH_BY_ID = exports.RESEARCH_CATALOGUE = exports.RESEARCH_CATEGORIES = void 0;
exports.researchCostForLevel = researchCostForLevel;
exports.researchDurationForLevel = researchDurationForLevel;
exports.evaluateResearchEntry = evaluateResearchEntry;
exports.RESEARCH_CATEGORIES = [
    { id: 'economy', name: 'Economy', displayOrder: 1 },
    { id: 'science', name: 'Science', displayOrder: 2 },
    { id: 'propulsion', name: 'Propulsion', displayOrder: 3 },
    { id: 'intelligence', name: 'Intelligence', displayOrder: 4 },
    { id: 'combat', name: 'Combat', displayOrder: 5 },
    { id: 'gate', name: 'Eon Gates', displayOrder: 6 },
];
/**
 * The authoritative, display-ordered catalogue for every research id that has
 * ever been persisted by the prototype. Keep ids stable: they are database
 * values, not presentation labels.
 */
exports.RESEARCH_CATALOGUE = [
    {
        id: 'alloyProcessing', name: 'Alloy Processing', description: 'Improves Alloy Mine yield.',
        category: 'economy', displayOrder: 10, baseCost: { alloy: 200, heliox: 100, aether: 0 }, costGrowth: 1.6,
        requirements: [{ kind: 'building', id: 'researchLab', level: 1 }],
        effect: { description: 'Alloy Mine yield bonus.', status: 'PLANNED' },
    },
    {
        id: 'helioxCombustion', name: 'Heliox Combustion', description: 'Improves Heliox Extractor yield and ship fuel efficiency.',
        category: 'economy', displayOrder: 20, baseCost: { alloy: 150, heliox: 200, aether: 0 }, costGrowth: 1.6,
        requirements: [{ kind: 'building', id: 'researchLab', level: 1 }],
        effect: { description: 'Heliox yield and fleet fuel-efficiency bonuses.', status: 'PLANNED' },
    },
    {
        id: 'aetherPhysics', name: 'Aether Physics', description: 'Improves Aether Synthesizer yield and unlocks advanced research.',
        category: 'science', displayOrder: 30, baseCost: { alloy: 300, heliox: 300, aether: 50 }, costGrowth: 1.7,
        requirements: [{ kind: 'building', id: 'researchLab', level: 4 }, { kind: 'building', id: 'aetherSynthesizer', level: 1 }],
        effect: { description: 'Unlocks Gate Theory prerequisites; Aether yield bonus is not connected.', status: 'PARTIAL' },
    },
    {
        id: 'propulsionTheory', name: 'Propulsion Theory', description: 'Increases fleet cruise speed.',
        category: 'propulsion', displayOrder: 40, baseCost: { alloy: 300, heliox: 200, aether: 20 }, costGrowth: 1.6,
        requirements: [{ kind: 'building', id: 'researchLab', level: 2 }],
        effect: { description: 'Fleet cruise-speed bonus.', status: 'PLANNED' },
    },
    {
        id: 'espionageTech', name: 'Espionage Technology', description: 'Increases the accuracy of espionage reports and counter-intel.',
        category: 'intelligence', displayOrder: 50, baseCost: { alloy: 200, heliox: 400, aether: 20 }, costGrowth: 1.6,
        requirements: [{ kind: 'building', id: 'researchLab', level: 3 }],
        effect: { description: 'Used by fleet espionage and counter-intelligence accuracy calculations.', status: 'ACTIVE' },
    },
    {
        id: 'shieldTech', name: 'Shield Technology', description: 'Increases ship and defence shield strength.',
        category: 'combat', displayOrder: 60, baseCost: { alloy: 300, heliox: 300, aether: 40 }, costGrowth: 1.7,
        requirements: [{ kind: 'building', id: 'researchLab', level: 4 }],
        effect: { description: 'Used by fleet combat shield calculations.', status: 'ACTIVE' },
    },
    {
        id: 'weaponTech', name: 'Weapon Technology', description: 'Increases ship and defence weapon damage.',
        category: 'combat', displayOrder: 70, baseCost: { alloy: 300, heliox: 300, aether: 40 }, costGrowth: 1.7,
        requirements: [{ kind: 'building', id: 'researchLab', level: 4 }],
        effect: { description: 'Used by fleet combat weapon calculations.', status: 'ACTIVE' },
    },
    {
        id: 'armourTech', name: 'Armour Technology', description: 'Increases ship and defence hull integrity.',
        category: 'combat', displayOrder: 80, baseCost: { alloy: 300, heliox: 300, aether: 40 }, costGrowth: 1.7,
        requirements: [{ kind: 'building', id: 'researchLab', level: 4 }],
        effect: { description: 'Used by fleet combat armour calculations.', status: 'ACTIVE' },
    },
    {
        id: 'gateTheory', name: 'Gate Theory', description: 'Allows analysis of Eon Gate fragments and, eventually, gate activation.',
        category: 'gate', displayOrder: 90, baseCost: { alloy: 1000, heliox: 1000, aether: 400 }, costGrowth: 1.8,
        requirements: [{ kind: 'research', id: 'aetherPhysics', level: 3 }, { kind: 'building', id: 'gateObservatory', level: 1 }],
        effect: { description: 'Required to activate an Eon Gate; fragment analysis remains incomplete.', status: 'PARTIAL' },
    },
];
exports.RESEARCH_BY_ID = Object.freeze(Object.fromEntries(exports.RESEARCH_CATALOGUE.map((entry) => [entry.id, entry])));
function validLevel(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function validSpeed(value) {
    return Number.isFinite(value) && value > 0 ? value : 0.01;
}
function researchCostForLevel(id, targetLevel) {
    const entry = exports.RESEARCH_BY_ID[id];
    const level = Math.max(1, validLevel(targetLevel));
    const factor = Math.pow(entry.costGrowth, level - 1);
    return {
        alloy: Math.round(entry.baseCost.alloy * factor),
        heliox: Math.round(entry.baseCost.heliox * factor),
        aether: Math.round(entry.baseCost.aether * factor),
    };
}
function researchDurationForLevel(id, targetLevel, researchLabLevel, researchSpeed) {
    const cost = researchCostForLevel(id, targetLevel);
    const labLevel = validLevel(researchLabLevel);
    const raw = (cost.alloy + cost.heliox + cost.aether * 2) / (1000 * (1 + labLevel));
    return Math.max(Math.round((raw / validSpeed(researchSpeed)) * 3600), 30);
}
function evaluateResearchEntry(input) {
    const entry = exports.RESEARCH_BY_ID[input.id];
    const currentLevel = validLevel(input.currentLevel);
    const nextLevel = currentLevel + 1;
    const requirements = entry.requirements.map((requirement) => {
        const currentLevelForRequirement = validLevel(requirement.kind === 'building'
            ? input.planetBuildingLevels[requirement.id]
            : input.accountResearchLevels[requirement.id]);
        return { ...requirement, currentLevel: currentLevelForRequirement, met: currentLevelForRequirement >= requirement.level };
    });
    const labLevel = validLevel(input.planetBuildingLevels.researchLab);
    return {
        id: entry.id,
        currentLevel,
        nextLevel,
        cost: researchCostForLevel(entry.id, nextLevel),
        durationSeconds: researchDurationForLevel(entry.id, nextLevel, labLevel, input.researchSpeed),
        researchLabLevel: labLevel,
        requirements,
        unmetRequirements: requirements.filter((requirement) => !requirement.met),
        meetsRequirements: requirements.every((requirement) => requirement.met),
    };
}

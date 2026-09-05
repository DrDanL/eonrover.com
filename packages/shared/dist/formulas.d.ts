import { BuildingKey, PlanetEnvironment, ResearchKey, ResourceAmounts, ShipKey } from './types';
/**
 * Cost of a building/research/ship at a given target level.
 * cost(level) = baseCost * growth^(level - 1)
 */
export declare function scaledCost(baseCost: ResourceAmounts, growth: number, level: number): ResourceAmounts;
export declare function buildingCost(key: BuildingKey, targetLevel: number): ResourceAmounts;
export declare function researchCost(key: ResearchKey, targetLevel: number): ResourceAmounts;
/**
 * Construction duration for a building level, in seconds, given the total
 * resource cost and the research lab level (which accelerates construction).
 * Formula: time = (alloy + heliox) / (2500 * (1 + labLevel)) / economySpeed
 * with a sensible floor so early buildings are not instant.
 */
export declare function buildingDurationSeconds(cost: ResourceAmounts, researchLabLevel: number, economySpeed: number): number;
/**
 * Research duration in seconds, slower than buildings and accelerated by lab level.
 */
export declare function researchDurationSeconds(cost: ResourceAmounts, researchLabLevel: number, researchSpeed: number): number;
export declare function shipyardDurationSeconds(baseSeconds: number, shipyardLevel: number, economySpeed: number): number;
/**
 * Hourly production for a resource-producing building.
 * production(level) = baseRate * level * 1.1^level * planetMultiplier * universeSpeed
 * baseRate is derived from the building's construction cost so richer buildings
 * yield more, keeping balance data in one place (constants.ts).
 */
export declare function hourlyProduction(key: Extract<BuildingKey, 'alloyMine' | 'helioxExtractor' | 'aetherSynthesizer'>, level: number, planetMultiplier: number, economySpeed: number, researchBonus?: number): number;
/** Energy produced/consumed by a building at a given level. */
export declare function buildingEnergy(key: BuildingKey, level: number, solarIndex: number): number;
/** Storage capacity for a resource given the storage building level. */
export declare function storageCapacity(storageLevel: number): number;
export declare function totalEnergySupply(solarArrayLevel: number, solarIndex: number): number;
/**
 * When energy consumption exceeds supply, production buildings run at a
 * reduced efficiency factor between 0 and 1.
 */
export declare function energyEfficiency(supply: number, consumption: number): number;
export declare function planetProductionMultiplier(env: PlanetEnvironment, resource: 'alloy' | 'heliox' | 'aether'): number;
/**
 * Given the last time production was calculated and now, returns the
 * resources accumulated since then, capped at storage capacity.
 */
export declare function accumulateProduction(currentAmount: number, hourlyRate: number, secondsElapsed: number, capacity: number): number;
export interface PlanetProductionInput {
    previousProductionAt: Date;
    currentTime: Date;
    resources: ResourceAmounts;
    buildingLevels: Partial<Record<BuildingKey, number>>;
    environment: PlanetEnvironment;
    storage: ResourceAmounts;
    energySupply: number;
    energyDemand: number;
    economySpeed: number;
    productionModifier?: number;
}
export interface PlanetProductionResult {
    resources: ResourceAmounts;
    lastProductionAt: Date;
    elapsedSeconds: number;
    hourlyRates: ResourceAmounts;
    energyEfficiency: number;
}
/**
 * Deterministically advances one planet from an explicit prior timestamp to
 * an explicit server timestamp. Resource Floats retain fractional production,
 * so no per-read rounding or separate remainder field is needed.
 */
export declare function calculatePlanetProduction(input: PlanetProductionInput): PlanetProductionResult;
/** Straight-line distance between two coordinates in a galaxy/system/slot addressing scheme. */
export declare function distanceBetween(a: {
    galaxy: number;
    system: number;
    slot: number;
}, b: {
    galaxy: number;
    system: number;
    slot: number;
}): number;
/**
 * Flight duration in seconds for a fleet given distance, the slowest ship's
 * speed, the chosen mission speed percentage (10-100) and the universe fleet
 * speed multiplier.
 */
export declare function flightDurationSeconds(distance: number, slowestShipSpeed: number, speedPercent: number, fleetSpeed: number): number;
/** Fuel (Heliox) consumed for the whole fleet for a one-way trip. */
export declare function fuelConsumption(ships: Partial<Record<ShipKey, number>>, distance: number, durationSeconds: number): number;
export interface CombatUnit {
    id: string;
    key: ShipKey | 'flakTurret' | 'railBattery' | 'planetaryShield';
    attack: number;
    shield: number;
    armour: number;
    hull: number;
    owner: 'attacker' | 'defender';
}
export interface CombatRoundResult {
    round: number;
    attackerLosses: string[];
    defenderLosses: string[];
}
export interface CombatResult {
    rounds: CombatRoundResult[];
    outcome: 'attacker' | 'defender' | 'draw';
    survivorsAttacker: CombatUnit[];
    survivorsDefender: CombatUnit[];
    debris: ResourceAmounts;
}
/**
 * Deterministic, seedable multi-round combat resolution (up to 6 rounds).
 * Each unit fires once per round at a random enemy target; damage exceeding
 * shield strength reduces hull, destroyed units are removed between rounds.
 * A side retreats/loses when it has no combat units left.
 */
export declare function resolveCombat(attackers: CombatUnit[], defenders: CombatUnit[], rng?: () => number): CombatResult;
/**
 * Espionage report accuracy (0-1) based on the difference between the
 * attacker's Espionage Technology level and the defender's counter-intel
 * (also Espionage Technology).
 */
export declare function espionageAccuracy(attackerLevel: number, defenderLevel: number): number;

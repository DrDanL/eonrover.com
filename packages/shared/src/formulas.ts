import {
  BASE_ENERGY_SUPPLY,
  BASE_STORAGE_CAPACITY,
  BUILDINGS,
  PLANET_TYPES,
  RESEARCH,
  SHIPS,
} from './constants';
import { BuildingKey, PlanetEnvironment, ResearchKey, ResourceAmounts, ResourceType, ShipKey } from './types';

/**
 * Cost of a building/research/ship at a given target level.
 * cost(level) = baseCost * growth^(level - 1)
 */
export function scaledCost(baseCost: ResourceAmounts, growth: number, level: number): ResourceAmounts {
  const factor = Math.pow(growth, Math.max(level - 1, 0));
  return {
    alloy: Math.round(baseCost.alloy * factor),
    heliox: Math.round(baseCost.heliox * factor),
    aether: Math.round(baseCost.aether * factor),
  };
}

export function buildingCost(key: BuildingKey, targetLevel: number): ResourceAmounts {
  const def = BUILDINGS[key];
  return scaledCost(def.baseCost, def.costGrowth, targetLevel);
}

export function researchCost(key: ResearchKey, targetLevel: number): ResourceAmounts {
  const def = RESEARCH[key];
  return scaledCost(def.baseCost, def.costGrowth, targetLevel);
}

/**
 * Construction duration for a building level, in seconds, given the total
 * resource cost and the research lab level (which accelerates construction).
 * Formula: time = (alloy + heliox) / (2500 * (1 + labLevel)) / economySpeed
 * with a sensible floor so early buildings are not instant.
 */
export function buildingDurationSeconds(
  cost: ResourceAmounts,
  researchLabLevel: number,
  economySpeed: number,
): number {
  const raw = (cost.alloy + cost.heliox) / (2500 * (1 + researchLabLevel));
  const scaled = raw / Math.max(economySpeed, 0.01);
  return Math.max(Math.round(scaled * 3600), 15);
}

/**
 * Research duration in seconds, slower than buildings and accelerated by lab level.
 */
export function researchDurationSeconds(
  cost: ResourceAmounts,
  researchLabLevel: number,
  researchSpeed: number,
): number {
  const raw = (cost.alloy + cost.heliox + cost.aether * 2) / (1000 * (1 + researchLabLevel));
  const scaled = raw / Math.max(researchSpeed, 0.01);
  return Math.max(Math.round(scaled * 3600), 30);
}

export function shipyardDurationSeconds(
  baseSeconds: number,
  shipyardLevel: number,
  economySpeed: number,
): number {
  const raw = baseSeconds / Math.max(1, Math.log2(shipyardLevel + 2));
  const scaled = raw / Math.max(economySpeed, 0.01);
  return Math.max(Math.round(scaled), 10);
}

/**
 * Hourly production for a resource-producing building.
 * production(level) = baseRate * level * 1.1^level * planetMultiplier * universeSpeed
 * baseRate is derived from the building's construction cost so richer buildings
 * yield more, keeping balance data in one place (constants.ts).
 */
export function hourlyProduction(
  key: Extract<BuildingKey, 'alloyMine' | 'helioxExtractor' | 'aetherSynthesizer'>,
  level: number,
  planetMultiplier: number,
  economySpeed: number,
  researchBonus = 1,
): number {
  if (level <= 0) return 0;
  const def = BUILDINGS[key];
  const baseRate = key === 'aetherSynthesizer' ? 3 : key === 'alloyMine' ? 30 : 20;
  const value = baseRate * level * Math.pow(1.1, level) * planetMultiplier * economySpeed * researchBonus;
  void def;
  return value;
}

/** Energy produced/consumed by a building at a given level. */
export function buildingEnergy(key: BuildingKey, level: number, solarIndex: number): number {
  if (level <= 0) return 0;
  const def = BUILDINGS[key];
  if (key === 'solarArray') {
    return def.baseEnergy * level * Math.pow(1.1, level) * (0.5 + solarIndex);
  }
  return def.baseEnergy * level;
}

/** Storage capacity for a resource given the storage building level. */
export function storageCapacity(storageLevel: number): number {
  return Math.round(BASE_STORAGE_CAPACITY * Math.pow(1.5, storageLevel));
}

export function totalEnergySupply(solarArrayLevel: number, solarIndex: number): number {
  return BASE_ENERGY_SUPPLY + buildingEnergy('solarArray', solarArrayLevel, solarIndex) * -1;
}

/**
 * When energy consumption exceeds supply, production buildings run at a
 * reduced efficiency factor between 0 and 1.
 */
export function energyEfficiency(supply: number, consumption: number): number {
  if (consumption <= 0) return 1;
  if (supply >= consumption) return 1;
  return Math.max(0, supply / consumption);
}

export function planetProductionMultiplier(
  env: PlanetEnvironment,
  resource: 'alloy' | 'heliox' | 'aether',
): number {
  return PLANET_TYPES[env.type].productionMultiplier[resource];
}

/**
 * Given the last time production was calculated and now, returns the
 * resources accumulated since then, capped at storage capacity.
 */
export function accumulateProduction(
  currentAmount: number,
  hourlyRate: number,
  secondsElapsed: number,
  capacity: number,
): number {
  if (![currentAmount, hourlyRate, secondsElapsed, capacity].every(Number.isFinite)) {
    throw new RangeError('Production values must be finite numbers');
  }
  if (hourlyRate < 0 || capacity < 0) {
    throw new RangeError('Production rates and storage capacities cannot be negative');
  }

  const boundedCurrent = Math.min(capacity, Math.max(0, currentAmount));
  if (secondsElapsed <= 0) return boundedCurrent;
  const gained = (hourlyRate * secondsElapsed) / 3600;
  const result = Math.min(capacity, boundedCurrent + gained);
  if (!Number.isFinite(result)) throw new RangeError('Calculated production must be finite');
  return Math.max(0, result);
}

const RESOURCE_PRODUCTION_BUILDING: Record<
  ResourceType,
  Extract<BuildingKey, 'alloyMine' | 'helioxExtractor' | 'aetherSynthesizer'>
> = {
  alloy: 'alloyMine',
  heliox: 'helioxExtractor',
  aether: 'aetherSynthesizer',
};

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

function requireFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number`);
}

/**
 * Deterministically advances one planet from an explicit prior timestamp to
 * an explicit server timestamp. Resource Floats retain fractional production,
 * so no per-read rounding or separate remainder field is needed.
 */
export function calculatePlanetProduction(input: PlanetProductionInput): PlanetProductionResult {
  const previousTime = input.previousProductionAt.getTime();
  const currentTime = input.currentTime.getTime();
  requireFinite('Previous production timestamp', previousTime);
  requireFinite('Current production timestamp', currentTime);
  requireFinite('Planet temperature', input.environment.temperature);
  requireFinite('Planet solar index', input.environment.solarIndex);
  requireFinite('Energy supply', input.energySupply);
  requireFinite('Energy demand', input.energyDemand);
  requireFinite('Economy speed', input.economySpeed);

  if (!(input.environment.type in PLANET_TYPES)) throw new RangeError('Unknown planet type');
  if (input.energySupply < 0 || input.energyDemand < 0 || input.economySpeed < 0) {
    throw new RangeError('Energy and economy values cannot be negative');
  }

  const productionModifier = input.productionModifier ?? 1;
  requireFinite('Production modifier', productionModifier);
  if (productionModifier < 0) throw new RangeError('Production modifier cannot be negative');

  for (const [key, level] of Object.entries(input.buildingLevels)) {
    requireFinite(`${key} level`, level);
    if (level < 0) throw new RangeError('Building levels cannot be negative');
  }

  const efficiency = energyEfficiency(input.energySupply, input.energyDemand);
  const elapsedSeconds = Math.max(0, (currentTime - previousTime) / 1000);
  const resources = {} as ResourceAmounts;
  const hourlyRates = {} as ResourceAmounts;

  for (const resource of ['alloy', 'heliox', 'aether'] as const) {
    const current = input.resources[resource];
    const capacity = input.storage[resource];
    requireFinite(`${resource} balance`, current);
    requireFinite(`${resource} storage`, capacity);
    if (capacity < 0) throw new RangeError('Storage capacities cannot be negative');

    const building = RESOURCE_PRODUCTION_BUILDING[resource];
    const level = input.buildingLevels[building] ?? 0;
    const planetMultiplier = planetProductionMultiplier(input.environment, resource);
    requireFinite(`${resource} planet multiplier`, planetMultiplier);

    const hourlyRate =
      hourlyProduction(building, level, planetMultiplier, input.economySpeed, productionModifier) * efficiency;
    requireFinite(`${resource} hourly production`, hourlyRate);
    if (hourlyRate < 0) throw new RangeError('Hourly production cannot be negative');

    hourlyRates[resource] = hourlyRate;
    resources[resource] = accumulateProduction(current, hourlyRate, elapsedSeconds, capacity);
  }

  return {
    resources,
    lastProductionAt: new Date(elapsedSeconds > 0 ? currentTime : previousTime),
    elapsedSeconds,
    hourlyRates,
    energyEfficiency: efficiency,
  };
}

/** Straight-line distance between two coordinates in a galaxy/system/slot addressing scheme. */
export function distanceBetween(
  a: { galaxy: number; system: number; slot: number },
  b: { galaxy: number; system: number; slot: number },
): number {
  if (a.galaxy !== b.galaxy) {
    return 20000 * Math.abs(a.galaxy - b.galaxy);
  }
  if (a.system !== b.system) {
    return 2700 + 95 * Math.abs(a.system - b.system);
  }
  if (a.slot !== b.slot) {
    return 1000 + 5 * Math.abs(a.slot - b.slot);
  }
  return 5;
}

/**
 * Flight duration in seconds for a fleet given distance, the slowest ship's
 * speed, the chosen mission speed percentage (10-100) and the universe fleet
 * speed multiplier.
 */
export function flightDurationSeconds(
  distance: number,
  slowestShipSpeed: number,
  speedPercent: number,
  fleetSpeed: number,
): number {
  const effectiveSpeed = slowestShipSpeed * (Math.min(100, Math.max(10, speedPercent)) / 100) * fleetSpeed;
  const seconds = 3500 * Math.sqrt((10 * distance) / effectiveSpeed) + 10;
  return Math.max(Math.round(seconds), 5);
}

/** Fuel (Heliox) consumed for the whole fleet for a one-way trip. */
export function fuelConsumption(
  ships: Partial<Record<ShipKey, number>>,
  distance: number,
  durationSeconds: number,
): number {
  let total = 0;
  for (const [key, count] of Object.entries(ships)) {
    if (!count) continue;
    const def = SHIPS[key as ShipKey];
    total += def.fuelPerDistance * distance * count * (1 + durationSeconds / 36000);
  }
  return Math.round(total);
}

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
export function resolveCombat(
  attackers: CombatUnit[],
  defenders: CombatUnit[],
  rng: () => number = Math.random,
): CombatResult {
  let att = attackers.map((u) => ({ ...u }));
  let def = defenders.map((u) => ({ ...u }));
  const rounds: CombatRoundResult[] = [];
  let debrisAlloy = 0;
  let debrisHeliox = 0;

  for (let round = 1; round <= 6; round += 1) {
    if (att.length === 0 || def.length === 0) break;
    const attackerLosses: string[] = [];
    const defenderLosses: string[] = [];

    const fire = (shooters: CombatUnit[], targets: CombatUnit[]) => {
      for (const shooter of shooters) {
        if (targets.length === 0) break;
        const target = targets[Math.floor(rng() * targets.length)];
        const netDamage = Math.max(0, shooter.attack - target.shield);
        target.hull -= netDamage;
      }
    };

    fire(att, def);
    fire(def, att);

    const destroyedAttackers = att.filter((u) => u.hull <= 0);
    const destroyedDefenders = def.filter((u) => u.hull <= 0);
    destroyedAttackers.forEach((u) => {
      attackerLosses.push(u.id);
      debrisAlloy += u.armour * 0.3;
    });
    destroyedDefenders.forEach((u) => {
      defenderLosses.push(u.id);
      debrisAlloy += u.armour * 0.3;
    });

    att = att.filter((u) => u.hull > 0);
    def = def.filter((u) => u.hull > 0);
    rounds.push({ round, attackerLosses, defenderLosses });
  }

  let outcome: 'attacker' | 'defender' | 'draw' = 'draw';
  if (att.length > 0 && def.length === 0) outcome = 'attacker';
  else if (def.length > 0 && att.length === 0) outcome = 'defender';

  return {
    rounds,
    outcome,
    survivorsAttacker: att,
    survivorsDefender: def,
    debris: {
      alloy: Math.round(debrisAlloy * 0.5),
      heliox: Math.round(debrisHeliox * 0.5),
      aether: 0,
    },
  };
}

/**
 * Espionage report accuracy (0-1) based on the difference between the
 * attacker's Espionage Technology level and the defender's counter-intel
 * (also Espionage Technology).
 */
export function espionageAccuracy(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel;
  const accuracy = 0.5 + diff * 0.08;
  return Math.min(1, Math.max(0.1, accuracy));
}

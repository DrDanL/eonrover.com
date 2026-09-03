import { BuildingKey, DefenceKey, PlanetType, ResearchKey, ResourceAmounts, ShipKey } from './types';

/**
 * Base definitions for buildings. Costs are for level 1 -> the formulas in
 * `formulas.ts` scale these up using an exponential growth factor per level.
 */
export interface BuildingDefinition {
  key: BuildingKey;
  name: string;
  description: string;
  baseCost: ResourceAmounts;
  costGrowth: number;
  /** base energy consumed (positive) or produced (negative) at level 1 */
  baseEnergy: number;
  producesResource?: 'alloy' | 'heliox' | 'aether';
  requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
}

export const BUILDINGS: Record<BuildingKey, BuildingDefinition> = {
  alloyMine: {
    key: 'alloyMine',
    name: 'Alloy Mine',
    description: 'Extracts and refines Alloy from the planet crust.',
    baseCost: { alloy: 60, heliox: 15, aether: 0 },
    costGrowth: 1.5,
    baseEnergy: 10,
    producesResource: 'alloy',
  },
  helioxExtractor: {
    key: 'helioxExtractor',
    name: 'Heliox Extractor',
    description: 'Condenses atmospheric Heliox for propulsion and energy use.',
    baseCost: { alloy: 48, heliox: 24, aether: 0 },
    costGrowth: 1.5,
    baseEnergy: 12,
    producesResource: 'heliox',
  },
  aetherSynthesizer: {
    key: 'aetherSynthesizer',
    name: 'Aether Synthesizer',
    description: 'Synthesises trace Aether particles for advanced research.',
    baseCost: { alloy: 200, heliox: 150, aether: 0 },
    costGrowth: 1.6,
    baseEnergy: 18,
    producesResource: 'aether',
    requires: { alloyMine: 5, helioxExtractor: 5 },
  },
  solarArray: {
    key: 'solarArray',
    name: 'Solar Array',
    description: 'Converts starlight into usable energy for the planet grid.',
    baseCost: { alloy: 75, heliox: 30, aether: 0 },
    costGrowth: 1.5,
    baseEnergy: -20,
  },
  alloyStorage: {
    key: 'alloyStorage',
    name: 'Alloy Depot',
    description: 'Increases maximum Alloy storage capacity.',
    baseCost: { alloy: 500, heliox: 0, aether: 0 },
    costGrowth: 2,
    baseEnergy: 0,
  },
  helioxStorage: {
    key: 'helioxStorage',
    name: 'Heliox Tank',
    description: 'Increases maximum Heliox storage capacity.',
    baseCost: { alloy: 500, heliox: 250, aether: 0 },
    costGrowth: 2,
    baseEnergy: 0,
  },
  aetherStorage: {
    key: 'aetherStorage',
    name: 'Aether Vault',
    description: 'Increases maximum Aether storage capacity.',
    baseCost: { alloy: 800, heliox: 400, aether: 100 },
    costGrowth: 2,
    baseEnergy: 0,
    requires: { aetherSynthesizer: 2 },
  },
  shipyard: {
    key: 'shipyard',
    name: 'Shipyard',
    description: 'Constructs ships and defensive structures.',
    baseCost: { alloy: 400, heliox: 200, aether: 100 },
    costGrowth: 1.6,
    baseEnergy: 0,
    requires: { alloyMine: 3 },
  },
  researchLab: {
    key: 'researchLab',
    name: 'Research Lab',
    description: 'Unlocks and accelerates technology research.',
    baseCost: { alloy: 250, heliox: 400, aether: 100 },
    costGrowth: 1.7,
    baseEnergy: 0,
  },
  gateObservatory: {
    key: 'gateObservatory',
    name: 'Gate Observatory',
    description: 'Detects and stabilises Eon Gate fragments for research and use.',
    baseCost: { alloy: 1200, heliox: 900, aether: 500 },
    costGrowth: 1.8,
    baseEnergy: 15,
    requires: { researchLab: 6 },
  },
};

export interface ResearchDefinition {
  key: ResearchKey;
  name: string;
  description: string;
  baseCost: ResourceAmounts;
  costGrowth: number;
  requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
}

export const RESEARCH: Record<ResearchKey, ResearchDefinition> = {
  alloyProcessing: {
    key: 'alloyProcessing',
    name: 'Alloy Processing',
    description: 'Improves Alloy Mine yield.',
    baseCost: { alloy: 200, heliox: 100, aether: 0 },
    costGrowth: 1.6,
    requires: { researchLab: 1 },
  },
  helioxCombustion: {
    key: 'helioxCombustion',
    name: 'Heliox Combustion',
    description: 'Improves Heliox Extractor yield and ship fuel efficiency.',
    baseCost: { alloy: 150, heliox: 200, aether: 0 },
    costGrowth: 1.6,
    requires: { researchLab: 1 },
  },
  aetherPhysics: {
    key: 'aetherPhysics',
    name: 'Aether Physics',
    description: 'Improves Aether Synthesizer yield and unlocks advanced research.',
    baseCost: { alloy: 300, heliox: 300, aether: 50 },
    costGrowth: 1.7,
    requires: { researchLab: 4, aetherSynthesizer: 1 },
  },
  propulsionTheory: {
    key: 'propulsionTheory',
    name: 'Propulsion Theory',
    description: 'Increases fleet cruise speed.',
    baseCost: { alloy: 300, heliox: 200, aether: 20 },
    costGrowth: 1.6,
    requires: { researchLab: 2 },
  },
  espionageTech: {
    key: 'espionageTech',
    name: 'Espionage Technology',
    description: 'Increases the accuracy of espionage reports and counter-intel.',
    baseCost: { alloy: 200, heliox: 400, aether: 20 },
    costGrowth: 1.6,
    requires: { researchLab: 3 },
  },
  shieldTech: {
    key: 'shieldTech',
    name: 'Shield Technology',
    description: 'Increases ship and defence shield strength.',
    baseCost: { alloy: 300, heliox: 300, aether: 40 },
    costGrowth: 1.7,
    requires: { researchLab: 4 },
  },
  weaponTech: {
    key: 'weaponTech',
    name: 'Weapon Technology',
    description: 'Increases ship and defence weapon damage.',
    baseCost: { alloy: 300, heliox: 300, aether: 40 },
    costGrowth: 1.7,
    requires: { researchLab: 4 },
  },
  armourTech: {
    key: 'armourTech',
    name: 'Armour Technology',
    description: 'Increases ship and defence hull integrity.',
    baseCost: { alloy: 300, heliox: 300, aether: 40 },
    costGrowth: 1.7,
    requires: { researchLab: 4 },
  },
  gateTheory: {
    key: 'gateTheory',
    name: 'Gate Theory',
    description: 'Allows analysis of Eon Gate fragments and, eventually, gate activation.',
    baseCost: { alloy: 1000, heliox: 1000, aether: 400 },
    costGrowth: 1.8,
    requires: { aetherPhysics: 3, gateObservatory: 1 },
  },
};

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

export const SHIPS: Record<ShipKey, ShipDefinition> = {
  scout: {
    key: 'scout',
    name: 'Scout',
    description: 'Fast, lightly armed vessel used to explore nearby systems.',
    cost: { alloy: 2000, heliox: 1000, aether: 0 },
    buildTimeSeconds: 900,
    speed: 12000,
    cargo: 5,
    fuelPerDistance: 0.02,
    attack: 1,
    shield: 1,
    armour: 400,
    requires: { shipyard: 1 },
  },
  probe: {
    key: 'probe',
    name: 'Probe',
    description: 'Unarmed espionage vessel used to gather intelligence.',
    cost: { alloy: 800, heliox: 400, aether: 0 },
    buildTimeSeconds: 600,
    speed: 18000,
    cargo: 0,
    fuelPerDistance: 0.01,
    attack: 0,
    shield: 0,
    armour: 100,
    requires: { shipyard: 1, espionageTech: 1 },
  },
  transporter: {
    key: 'transporter',
    name: 'Transporter',
    description: 'Bulk hauler used to move resources between planets.',
    cost: { alloy: 3000, heliox: 1500, aether: 0 },
    buildTimeSeconds: 1800,
    speed: 6000,
    cargo: 4000,
    fuelPerDistance: 0.05,
    attack: 2,
    shield: 5,
    armour: 3000,
    requires: { shipyard: 2 },
  },
  colonyShip: {
    key: 'colonyShip',
    name: 'Colony Ship',
    description: 'Carries the equipment required to found a new colony.',
    cost: { alloy: 12000, heliox: 8000, aether: 2000 },
    buildTimeSeconds: 7200,
    speed: 3000,
    cargo: 8000,
    fuelPerDistance: 0.1,
    attack: 1,
    shield: 10,
    armour: 6000,
    requires: { shipyard: 4, propulsionTheory: 2 },
  },
  corvette: {
    key: 'corvette',
    name: 'Corvette',
    description: 'Light combat vessel, the backbone of early fleets.',
    cost: { alloy: 4000, heliox: 1200, aether: 0 },
    buildTimeSeconds: 2400,
    speed: 9000,
    cargo: 100,
    fuelPerDistance: 0.06,
    attack: 60,
    shield: 15,
    armour: 3500,
    requires: { shipyard: 2, weaponTech: 1 },
  },
  frigate: {
    key: 'frigate',
    name: 'Frigate',
    description: 'Heavier combat vessel with stronger shielding.',
    cost: { alloy: 9000, heliox: 4000, aether: 500 },
    buildTimeSeconds: 5400,
    speed: 7000,
    cargo: 400,
    fuelPerDistance: 0.08,
    attack: 180,
    shield: 40,
    armour: 9000,
    requires: { shipyard: 5, weaponTech: 3, shieldTech: 2 },
  },
  recycler: {
    key: 'recycler',
    name: 'Recycler',
    description: 'Salvages debris fields left behind after fleet battles.',
    cost: { alloy: 5000, heliox: 3000, aether: 0 },
    buildTimeSeconds: 3000,
    speed: 4000,
    cargo: 15000,
    fuelPerDistance: 0.07,
    attack: 1,
    shield: 10,
    armour: 5000,
    requires: { shipyard: 3 },
  },
};

export const DEFENCES: Record<
  DefenceKey,
  {
    key: DefenceKey;
    name: string;
    cost: ResourceAmounts;
    buildTimeSeconds: number;
    attack: number;
    shield: number;
    armour: number;
    requires?: Partial<Record<BuildingKey | ResearchKey, number>>;
  }
> = {
  flakTurret: {
    key: 'flakTurret',
    name: 'Flak Turret',
    cost: { alloy: 2000, heliox: 0, aether: 0 },
    buildTimeSeconds: 600,
    attack: 40,
    shield: 10,
    armour: 2000,
    requires: { shipyard: 1 },
  },
  railBattery: {
    key: 'railBattery',
    name: 'Rail Battery',
    cost: { alloy: 6000, heliox: 2000, aether: 0 },
    buildTimeSeconds: 1500,
    attack: 220,
    shield: 25,
    armour: 6000,
    requires: { shipyard: 4, weaponTech: 2 },
  },
  planetaryShield: {
    key: 'planetaryShield',
    name: 'Planetary Shield',
    cost: { alloy: 15000, heliox: 8000, aether: 1000 },
    buildTimeSeconds: 5400,
    attack: 1,
    shield: 2000,
    armour: 12000,
    requires: { shipyard: 6, shieldTech: 4 },
  },
};

export interface PlanetTypeProfile {
  type: PlanetType;
  temperatureRange: [number, number];
  solarIndexRange: [number, number];
  productionMultiplier: Record<'alloy' | 'heliox' | 'aether', number>;
}

/** Governs how planet type/temperature affects production and colonisation. */
export const PLANET_TYPES: Record<PlanetType, PlanetTypeProfile> = {
  temperate: {
    type: 'temperate',
    temperatureRange: [-10, 30],
    solarIndexRange: [0.5, 0.8],
    productionMultiplier: { alloy: 1.0, heliox: 1.0, aether: 1.0 },
  },
  volcanic: {
    type: 'volcanic',
    temperatureRange: [30, 60],
    solarIndexRange: [0.7, 1.0],
    productionMultiplier: { alloy: 1.25, heliox: 0.85, aether: 0.9 },
  },
  ice: {
    type: 'ice',
    temperatureRange: [-60, -20],
    solarIndexRange: [0.2, 0.4],
    productionMultiplier: { alloy: 0.85, heliox: 1.2, aether: 1.0 },
  },
  gasGiant: {
    type: 'gasGiant',
    temperatureRange: [-40, 10],
    solarIndexRange: [0.3, 0.6],
    productionMultiplier: { alloy: 0.7, heliox: 1.35, aether: 1.05 },
  },
  barren: {
    type: 'barren',
    temperatureRange: [0, 50],
    solarIndexRange: [0.6, 0.9],
    productionMultiplier: { alloy: 1.1, heliox: 0.9, aether: 0.95 },
  },
  oceanic: {
    type: 'oceanic',
    temperatureRange: [-5, 25],
    solarIndexRange: [0.4, 0.7],
    productionMultiplier: { alloy: 0.9, heliox: 1.05, aether: 1.15 },
  },
};

export interface UniverseConfig {
  universeSpeed: number;
  economySpeed: number;
  fleetSpeed: number;
  researchSpeed: number;
  newPlayerProtectionHours: number;
  maxPlanetsPerPlayer: number;
}

export const DEFAULT_UNIVERSE_CONFIG: UniverseConfig = {
  universeSpeed: 1,
  economySpeed: 1,
  fleetSpeed: 1,
  researchSpeed: 1,
  newPlayerProtectionHours: 72,
  maxPlanetsPerPlayer: 9,
};

export const STARTING_RESOURCES: ResourceAmounts = { alloy: 500, heliox: 300, aether: 0 };
export const BASE_STORAGE_CAPACITY = 10000;
export const BASE_ENERGY_SUPPLY = 20;

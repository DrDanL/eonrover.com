export type ResourceType = 'alloy' | 'heliox' | 'aether';

export interface ResourceAmounts {
  alloy: number;
  heliox: number;
  aether: number;
}

export const RESOURCE_TYPES: ResourceType[] = ['alloy', 'heliox', 'aether'];

export type BuildingKey =
  | 'alloyMine'
  | 'helioxExtractor'
  | 'aetherSynthesizer'
  | 'solarArray'
  | 'alloyStorage'
  | 'helioxStorage'
  | 'aetherStorage'
  | 'shipyard'
  | 'researchLab'
  | 'gateObservatory';

export type ResearchKey =
  | 'alloyProcessing'
  | 'helioxCombustion'
  | 'aetherPhysics'
  | 'propulsionTheory'
  | 'espionageTech'
  | 'shieldTech'
  | 'weaponTech'
  | 'armourTech'
  | 'gateTheory';

export type ShipKey =
  | 'scout'
  | 'transporter'
  | 'colonyShip'
  | 'corvette'
  | 'frigate'
  | 'recycler'
  | 'probe';

export type DefenceKey = 'flakTurret' | 'railBattery' | 'planetaryShield';

export interface BuildingCost extends ResourceAmounts {
  energy: number;
}

export type PlanetType = 'temperate' | 'volcanic' | 'ice' | 'gasGiant' | 'barren' | 'oceanic';

export interface PlanetEnvironment {
  type: PlanetType;
  /** -60 to 60 celsius, affects production & colonisation suitability */
  temperature: number;
  /** 0-1, multiplies solar energy generation */
  solarIndex: number;
}

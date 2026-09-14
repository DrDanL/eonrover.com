import { DEFENCES } from './constants';
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
 * command.  Only Flak Turrets are enabled in this bounded stage.
 */
export const DEFENCE_CATALOGUE: readonly DefenceCatalogueEntry[] = [
  { id: 'flakTurret', displayOrder: 10, availability: 'ACTIVE', availabilityMessage: 'Available for Shipyard construction.' },
  { id: 'railBattery', displayOrder: 20, availability: 'COMING_LATER', availabilityMessage: 'Coming later.' },
  { id: 'planetaryShield', displayOrder: 30, availability: 'COMING_LATER', availabilityMessage: 'Coming later.' },
] as const;

export const DEFENCE_BY_ID = Object.freeze(Object.fromEntries(DEFENCE_CATALOGUE.map((entry) => [entry.id, entry]))) as Readonly<Record<DefenceKey, DefenceCatalogueEntry>>;

export const ACTIVE_SHIPYARD_DEFENCE_KEYS = ['flakTurret'] as const satisfies readonly DefenceKey[];
export type ActiveShipyardDefenceKey = (typeof ACTIVE_SHIPYARD_DEFENCE_KEYS)[number];

export function isActiveShipyardDefenceKey(value: unknown): value is ActiveShipyardDefenceKey {
  return typeof value === 'string' && (ACTIVE_SHIPYARD_DEFENCE_KEYS as readonly string[]).includes(value);
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

export function evaluateDefenceCatalogue(input: {
  id: DefenceKey;
  shipyardLevel: number;
  economySpeed: number;
  buildingLevels: Record<string, number>;
  researchLevels: Record<string, number>;
  durationForBaseSeconds: (baseSeconds: number, shipyardLevel: number, economySpeed: number) => number;
}) {
  const entry = DEFENCE_BY_ID[input.id];
  const definition = DEFENCES[input.id];
  const durationSeconds = input.durationForBaseSeconds(definition.buildTimeSeconds, input.shipyardLevel, input.economySpeed);
  const requirements = Object.entries(definition.requires ?? {}).map(([id, requiredLevel]) => {
    const currentLevel = finite(`${id} level`, input.buildingLevels[id] ?? input.researchLevels[id] ?? 0);
    return {
      id: id as BuildingKey | ResearchKey,
      requiredLevel: finite(`${id} requirement`, requiredLevel ?? 0),
      currentLevel,
      met: currentLevel >= (requiredLevel ?? 0),
      type: id in input.buildingLevels || id === 'shipyard' ? 'building' as const : 'research' as const,
    };
  });
  const cost: ResourceAmounts = { ...definition.cost };
  for (const [label, value] of Object.entries({ ...cost, attack: definition.attack, shield: definition.shield, armour: definition.armour })) finite(`${input.id} ${label}`, value);
  return {
    ...entry,
    key: definition.key,
    name: definition.name,
    cost,
    durationSeconds,
    statistics: { attack: definition.attack, shield: definition.shield, armour: definition.armour },
    requirements,
    meetsRequirements: requirements.every((requirement) => requirement.met),
  };
}

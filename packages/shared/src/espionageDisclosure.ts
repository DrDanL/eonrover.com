import { BUILDINGS, DEFENCES, GALAXY_COORDINATE_BOUNDS, PLANET_TYPES, SHIPS } from './constants';
import { espionageAccuracy } from './formulas';
import {
  BuildingKey,
  DefenceKey,
  PlanetType,
  ResourceAmounts,
  ShipKey,
} from './types';

/**
 * `espionageAccuracy` is bounded to 0.1 through 1.0. These thresholds divide
 * that score into deterministic, named disclosure tiers without changing the
 * underlying research formula or any balance value.
 */
export const ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS = Object.freeze({
  RESOURCES: 0.4,
  BUILDINGS: 0.6,
  FORCES: 0.8,
});

export type EspionageDisclosureTier = 'IDENTITY' | 'RESOURCES' | 'BUILDINGS' | 'FORCES';

export type EspionageTargetCoordinates = {
  galaxy: number;
  system: number;
  slot: number;
};

/**
 * A deliberately settled, minimal target snapshot. Callers must construct it
 * from authoritative state before asking the pure policy to project a report.
 */
export type EspionageDisclosureTargetSnapshot = {
  publicIdentity: {
    coordinates: EspionageTargetCoordinates;
    planetName: string;
    planetType: PlanetType;
    ownerUsername: string;
  };
  resources: ResourceAmounts;
  completedBuildings: Partial<Record<BuildingKey, number>>;
  ships: Partial<Record<ShipKey, number>>;
  defences: Partial<Record<DefenceKey, number>>;
};

export type EspionageDisclosureInput = {
  attackerEspionageTechnology: number;
  defenderEspionageTechnology: number;
  target: EspionageDisclosureTargetSnapshot;
};

export type EspionagePublicTargetIdentity = EspionageDisclosureTargetSnapshot['publicIdentity'];

export type EspionageDisclosureReport = {
  target: EspionagePublicTargetIdentity;
  tier: EspionageDisclosureTier;
  resources?: ResourceAmounts;
  buildings?: Partial<Record<BuildingKey, number>>;
  ships?: Partial<Record<ShipKey, number>>;
  defences?: Partial<Record<DefenceKey, number>>;
};

export type EspionageDisclosureErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TECHNOLOGY_LEVEL'
  | 'INVALID_TARGET_SNAPSHOT'
  | 'INVALID_ACCURACY';

export class EspionageDisclosureError extends Error {
  constructor(public readonly code: EspionageDisclosureErrorCode, message: string) {
    super(message);
    this.name = 'EspionageDisclosureError';
  }
}

function fail(code: EspionageDisclosureErrorCode, message: string): never {
  throw new EspionageDisclosureError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalNonNegativeNumber(value: unknown, code: EspionageDisclosureErrorCode, description: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(code, `${description} must be a finite non-negative number.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalNonNegativeSafeInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('INVALID_TARGET_SNAPSHOT', `${description} must be a finite non-negative safe integer.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalCoordinates(value: unknown): EspionageTargetCoordinates {
  if (!isRecord(value)) return fail('INVALID_TARGET_SNAPSHOT', 'Target coordinates are required.');
  const { galaxy, system, slot } = value;
  if (
    typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
    || typeof system !== 'number' || !Number.isSafeInteger(system)
    || typeof slot !== 'number' || !Number.isSafeInteger(slot)
    || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max
    || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max
  ) {
    return fail('INVALID_TARGET_SNAPSHOT', 'Target coordinates must satisfy the canonical Galaxy bounds.');
  }
  return { galaxy, system, slot };
}

function canonicalIdentity(value: unknown): EspionagePublicTargetIdentity {
  if (!isRecord(value)) return fail('INVALID_TARGET_SNAPSHOT', 'Target public identity is required.');
  const { coordinates, planetName, planetType, ownerUsername } = value;
  if (typeof planetName !== 'string' || planetName.length === 0
    || typeof ownerUsername !== 'string' || ownerUsername.length === 0
    || typeof planetType !== 'string' || !(planetType in PLANET_TYPES)) {
    return fail('INVALID_TARGET_SNAPSHOT', 'Target public identity is invalid.');
  }
  return {
    coordinates: canonicalCoordinates(coordinates),
    planetName,
    planetType: planetType as PlanetType,
    ownerUsername,
  };
}

function canonicalResources(value: unknown): ResourceAmounts {
  if (!isRecord(value)) return fail('INVALID_TARGET_SNAPSHOT', 'Target resources are required.');
  return {
    alloy: canonicalNonNegativeNumber(value.alloy, 'INVALID_TARGET_SNAPSHOT', 'Target Alloy'),
    heliox: canonicalNonNegativeNumber(value.heliox, 'INVALID_TARGET_SNAPSHOT', 'Target Heliox'),
    aether: canonicalNonNegativeNumber(value.aether, 'INVALID_TARGET_SNAPSHOT', 'Target Aether'),
  };
}

function canonicalCompletedBuildings(value: unknown): Partial<Record<BuildingKey, number>> {
  if (!isRecord(value)) return fail('INVALID_TARGET_SNAPSHOT', 'Target completed buildings are required.');
  const buildings: Partial<Record<BuildingKey, number>> = {};
  for (const key of Object.keys(BUILDINGS).sort() as BuildingKey[]) {
    if (value[key] === undefined) continue;
    const level = canonicalNonNegativeSafeInteger(value[key], `Target completed building ${key}`);
    if (level > 0) buildings[key] = level;
  }
  return buildings;
}

function canonicalQuantities<Key extends string>(
  value: unknown,
  definitions: Record<Key, unknown>,
  description: string,
): Partial<Record<Key, number>> {
  if (!isRecord(value)) return fail('INVALID_TARGET_SNAPSHOT', `Target ${description} are required.`);
  const quantities: Partial<Record<Key, number>> = {};
  for (const key of Object.keys(definitions).sort() as Key[]) {
    if (value[key] === undefined) continue;
    const quantity = canonicalNonNegativeSafeInteger(value[key], `Target ${description} ${key}`);
    if (quantity > 0) quantities[key] = quantity;
  }
  return quantities;
}

function canonicalTarget(value: unknown): EspionageDisclosureTargetSnapshot {
  if (!isRecord(value)) return fail('INVALID_INPUT', 'Espionage disclosure requires a settled target snapshot.');
  return {
    publicIdentity: canonicalIdentity(value.publicIdentity),
    resources: canonicalResources(value.resources),
    completedBuildings: canonicalCompletedBuildings(value.completedBuildings),
    ships: canonicalQuantities(value.ships, SHIPS, 'ships'),
    defences: canonicalQuantities(value.defences, DEFENCES, 'defences'),
  };
}

/** Maps an already calculated accuracy score to a public disclosure tier. */
export function espionageDisclosureTierForAccuracy(accuracy: number): EspionageDisclosureTier {
  if (!Number.isFinite(accuracy) || accuracy < 0.1 || accuracy > 1) {
    return fail('INVALID_ACCURACY', 'Espionage accuracy must be within the formula range of 0.1 through 1.');
  }
  if (accuracy >= ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.FORCES) return 'FORCES';
  if (accuracy >= ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.BUILDINGS) return 'BUILDINGS';
  if (accuracy >= ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS.RESOURCES) return 'RESOURCES';
  return 'IDENTITY';
}

/**
 * Projects a deterministic, privacy-safe report from an already-authoritative
 * snapshot. The policy builds every tier from explicit allowlists and never
 * serialises arbitrary input data.
 */
export function discloseEspionageTarget(input: unknown): EspionageDisclosureReport {
  if (!isRecord(input)) return fail('INVALID_INPUT', 'Espionage disclosure input is invalid.');
  const attackerLevel = canonicalNonNegativeNumber(
    input.attackerEspionageTechnology,
    'INVALID_TECHNOLOGY_LEVEL',
    'Attacker Espionage Technology level',
  );
  const defenderLevel = canonicalNonNegativeNumber(
    input.defenderEspionageTechnology,
    'INVALID_TECHNOLOGY_LEVEL',
    'Defender Espionage Technology level',
  );
  const target = canonicalTarget(input.target);
  const tier = espionageDisclosureTierForAccuracy(espionageAccuracy(attackerLevel, defenderLevel));
  const report: EspionageDisclosureReport = { target: target.publicIdentity, tier };

  if (tier === 'IDENTITY') return report;
  report.resources = target.resources;
  if (tier === 'RESOURCES') return report;
  report.buildings = target.completedBuildings;
  if (tier === 'BUILDINGS') return report;
  report.ships = target.ships;
  report.defences = target.defences;
  return report;
}

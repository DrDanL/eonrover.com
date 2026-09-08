import { COLONY_STARTER_STATE, PLANET_TYPES, SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';
import { PlanetType } from './types';

export const COLONIZATION_SPEED_PERCENT = 100;
export const COLONIZATION_MIN_SLOT = 1;
export const COLONIZATION_MAX_SLOT = 12;

export type ColonizationCoordinates = {
  galaxy: number;
  system: number;
  slot: number;
};

export type ColonizationPlan = {
  target: ColonizationCoordinates;
  ships: { colonyShip: 1 };
  speedPercent: typeof COLONIZATION_SPEED_PERCENT;
  durationSeconds: number;
  fuelHeliox: number;
};

export type ColonyCharacteristics = {
  planetType: PlanetType;
  temperature: number;
  solarIndex: number;
  fieldCapacity: number;
};

export type ColonizationPlannerInput = {
  origin: ColonizationCoordinates;
  targetSlot: unknown;
  ships: unknown;
  fleetSpeed: unknown;
  cargo?: unknown;
  escorts?: unknown;
  recall?: unknown;
  speedPercent?: unknown;
};

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function assertOrigin(origin: ColonizationCoordinates): void {
  if (!origin || !finitePositiveInteger(origin.galaxy) || !finitePositiveInteger(origin.system) || !finitePositiveInteger(origin.slot)) {
    throw new Error('Colonization origin coordinates are invalid.');
  }
}

function canonicalColonyShip(input: unknown): { colonyShip: 1 } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Colonization requires exactly one Colony Ship.');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== 'colonyShip' || entries[0][1] !== 1) {
    throw new Error('Colonization requires exactly one Colony Ship and no escorts.');
  }
  return { colonyShip: 1 };
}

/**
 * Plans only the bounded, same-system colony mission. The caller can select
 * neither speed nor cargo; all values returned here are derived from server
 * coordinates, the fixed Colony Ship definition, and the configured fleet
 * speed.
 */
export function planSameSystemColonization(input: ColonizationPlannerInput): ColonizationPlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Colonization input is invalid.');
  }
  const allowedKeys = new Set(['origin', 'targetSlot', 'ships', 'fleetSpeed']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new Error('Colonization does not permit caller-selected coordinates, cargo, escorts, recall, or speed.');
  }
  if (
    input.cargo !== undefined
    || input.escorts !== undefined
    || input.recall !== undefined
    || input.speedPercent !== undefined
  ) {
    throw new Error('Colonization does not permit cargo, escorts, recall, or caller-selected speed.');
  }
  assertOrigin(input.origin);
  if (!finitePositiveInteger(input.targetSlot)
    || input.targetSlot < COLONIZATION_MIN_SLOT
    || input.targetSlot > COLONIZATION_MAX_SLOT
    || input.targetSlot === input.origin.slot) {
    throw new Error('Colonization target slot must be an empty slot from 1 through 12 in the origin system.');
  }
  if (typeof input.fleetSpeed !== 'number' || !Number.isFinite(input.fleetSpeed) || input.fleetSpeed <= 0) {
    throw new Error('Colonization fleet speed is invalid.');
  }
  const ships = canonicalColonyShip(input.ships);
  const target = { galaxy: input.origin.galaxy, system: input.origin.system, slot: input.targetSlot };
  const distance = distanceBetween(input.origin, target);
  const durationSeconds = flightDurationSeconds(
    distance,
    SHIPS.colonyShip.speed,
    COLONIZATION_SPEED_PERCENT,
    input.fleetSpeed,
  );
  const fuelHeliox = fuelConsumption(ships, distance, durationSeconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(fuelHeliox) || fuelHeliox < 0) {
    throw new Error('Colonization calculation is invalid.');
  }
  return { target, ships, speedPercent: COLONIZATION_SPEED_PERCENT, durationSeconds, fuelHeliox };
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitInterval(seed: string): number {
  return hash32(seed) / 0xffffffff;
}

/**
 * Derives a stable, server-persistable environmental profile from the mission
 * identifier. Completion consumes the accepted snapshot and never randomises
 * an arriving colony.
 */
export function deriveColonyCharacteristics(missionId: string): ColonyCharacteristics {
  if (typeof missionId !== 'string' || !missionId.trim()) {
    throw new Error('Colonization mission id is invalid.');
  }
  const keys = Object.keys(PLANET_TYPES).sort() as PlanetType[];
  const planetType = keys[hash32(`${missionId}:type`) % keys.length];
  const profile = PLANET_TYPES[planetType];
  const [temperatureMin, temperatureMax] = profile.temperatureRange;
  const [solarMin, solarMax] = profile.solarIndexRange;
  const temperature = Math.round(temperatureMin + unitInterval(`${missionId}:temperature`) * (temperatureMax - temperatureMin));
  const solarIndex = Number((solarMin + unitInterval(`${missionId}:solar`) * (solarMax - solarMin)).toFixed(6));
  if (!Number.isInteger(temperature) || !Number.isFinite(solarIndex) || solarIndex < solarMin || solarIndex > solarMax) {
    throw new Error('Colonization characteristics are invalid.');
  }
  return { planetType, temperature, solarIndex, fieldCapacity: COLONY_STARTER_STATE.fieldCapacity };
}

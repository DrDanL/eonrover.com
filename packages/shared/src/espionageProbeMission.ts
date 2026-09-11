import { GALAXY_COORDINATE_BOUNDS, SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';

/** Espionage Probe travel is deliberately fixed; disclosure rules come later. */
export const ESPIONAGE_PROBE_SPEED_PERCENT = 100;

export type EspionageProbeCoordinates = {
  galaxy: number;
  system: number;
  slot: number;
};

export type EspionageProbePlanErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_COORDINATES'
  | 'IDENTICAL_COORDINATES'
  | 'CROSS_GALAXY_TARGET'
  | 'INVALID_FLEET_SPEED'
  | 'INVALID_CALCULATION';

/** Stable validation error for later service-layer error mapping. */
export class EspionageProbePlanError extends Error {
  constructor(public readonly code: EspionageProbePlanErrorCode, message: string) {
    super(message);
    this.name = 'EspionageProbePlanError';
  }
}

export type EspionageProbePlan = {
  ships: { probe: 1 };
  speedPercent: typeof ESPIONAGE_PROBE_SPEED_PERCENT;
  outboundDurationSeconds: number;
  returnDurationSeconds: number;
  outboundFuelHeliox: number;
  returnFuelHeliox: number;
  timing: {
    arrivalAfterDepartureSeconds: number;
    returnAfterArrivalSeconds: number;
  };
};

type EspionageProbePlannerInput = {
  origin: unknown;
  target: unknown;
  fleetSpeed: unknown;
};

function fail(code: EspionageProbePlanErrorCode, message: string): never {
  throw new EspionageProbePlanError(code, message);
}

function coordinate(value: unknown): EspionageProbeCoordinates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('INVALID_COORDINATES', 'Probe origin and target coordinates must be bounded integers.');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = ['galaxy', 'slot', 'system'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return fail('INVALID_COORDINATES', 'Probe origin and target coordinates must contain exactly galaxy, system, and slot.');
  }
  const { galaxy, system, slot } = candidate;
  if (
    typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
    || typeof system !== 'number' || !Number.isSafeInteger(system)
    || typeof slot !== 'number' || !Number.isSafeInteger(slot)
    || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max
    || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max
  ) {
    return fail('INVALID_COORDINATES', 'Probe origin and target coordinates are outside the canonical Galaxy bounds.');
  }
  return { galaxy, system, slot };
}

/**
 * Plans the future intelligence-only Probe journey from server-resolved
 * coordinates. It accepts neither caller-selected ships, cargo, speed, timing,
 * report accuracy, nor a target identity.
 */
export function planEspionageProbeMission(input: unknown): EspionageProbePlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('INVALID_INPUT', 'Probe planning input is invalid.');
  }
  const candidate = input as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const allowedKeys = ['fleetSpeed', 'origin', 'target'];
  if (keys.length !== allowedKeys.length || keys.some((key, index) => key !== allowedKeys[index])) {
    return fail('INVALID_INPUT', 'Probe planning accepts only origin, target, and trusted fleet speed.');
  }

  const values = candidate as EspionageProbePlannerInput;
  const origin = coordinate(values.origin);
  const target = coordinate(values.target);
  if (origin.galaxy !== target.galaxy) {
    return fail('CROSS_GALAXY_TARGET', 'Probe targets must be in the same galaxy as their origin.');
  }
  if (origin.system === target.system && origin.slot === target.slot) {
    return fail('IDENTICAL_COORDINATES', 'Probe origin and target coordinates must be distinct.');
  }
  if (typeof values.fleetSpeed !== 'number' || !Number.isFinite(values.fleetSpeed) || values.fleetSpeed <= 0) {
    return fail('INVALID_FLEET_SPEED', 'Probe fleet speed must be finite and positive.');
  }

  const ships = { probe: 1 } as const;
  const distance = distanceBetween(origin, target);
  const outboundDurationSeconds = flightDurationSeconds(
    distance,
    SHIPS.probe.speed,
    ESPIONAGE_PROBE_SPEED_PERCENT,
    values.fleetSpeed,
  );
  const outboundFuelHeliox = fuelConsumption(ships, distance, outboundDurationSeconds);
  const returnDurationSeconds = outboundDurationSeconds;
  const returnFuelHeliox = outboundFuelHeliox;
  if (
    !Number.isInteger(outboundDurationSeconds) || outboundDurationSeconds <= 0
    || !Number.isSafeInteger(outboundFuelHeliox) || outboundFuelHeliox < 0
    || !Number.isInteger(returnDurationSeconds) || returnDurationSeconds <= 0
    || !Number.isSafeInteger(returnFuelHeliox) || returnFuelHeliox < 0
  ) {
    return fail('INVALID_CALCULATION', 'Probe planning produced invalid travel values.');
  }
  return {
    ships,
    speedPercent: ESPIONAGE_PROBE_SPEED_PERCENT,
    outboundDurationSeconds,
    returnDurationSeconds,
    outboundFuelHeliox,
    returnFuelHeliox,
    timing: {
      arrivalAfterDepartureSeconds: outboundDurationSeconds,
      returnAfterArrivalSeconds: returnDurationSeconds,
    },
  };
}

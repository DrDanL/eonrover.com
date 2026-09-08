import { SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';
import { ShipKey } from './types';

export type DeployCoordinates = { galaxy: number; system: number; slot: number };
export type DeployPlan = { ships: Record<ShipKey, number>; speedPercent: number; durationSeconds: number; fuelHeliox: number };

function finitePositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0; }
function validCoordinates(value: DeployCoordinates): boolean { return finitePositiveInteger(value.galaxy) && finitePositiveInteger(value.system) && finitePositiveInteger(value.slot); }

export function canonicalDeployShips(input: unknown): Record<ShipKey, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Deploy ships must be a non-empty object.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) throw new Error('Deploy ships must be non-empty.');
  const result = {} as Record<ShipKey, number>;
  for (const key of Object.keys(SHIPS).sort() as ShipKey[]) {
    const found = entries.find(([candidate]) => candidate === key);
    if (found && finitePositiveInteger(found[1])) result[key] = found[1];
  }
  if (Object.keys(result).length !== entries.length) throw new Error('Deploy ships contain an unknown or invalid quantity.');
  return result;
}

export function planDeploy(input: { ships: unknown; speedPercent: unknown; origin: DeployCoordinates; destination: DeployCoordinates; fleetSpeed: unknown; cargo?: unknown }): DeployPlan {
  if (input.cargo !== undefined) throw new Error('Deploy missions do not permit cargo.');
  if (!finitePositiveInteger(input.speedPercent) || input.speedPercent < 10 || input.speedPercent > 100) throw new Error('Deploy speed must be an integer from 10 through 100.');
  if (typeof input.fleetSpeed !== 'number' || !Number.isFinite(input.fleetSpeed) || input.fleetSpeed <= 0 || !validCoordinates(input.origin) || !validCoordinates(input.destination)) throw new Error('Deploy travel inputs are invalid.');
  const ships = canonicalDeployShips(input.ships);
  const distance = distanceBetween(input.origin, input.destination);
  const slowest = Math.min(...Object.keys(ships).map((key) => SHIPS[key as ShipKey].speed));
  const durationSeconds = flightDurationSeconds(distance, slowest, input.speedPercent, input.fleetSpeed);
  const fuelHeliox = fuelConsumption(ships, distance, durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fuelHeliox) || fuelHeliox < 0) throw new Error('Deploy calculation is invalid.');
  return { ships, speedPercent: input.speedPercent, durationSeconds, fuelHeliox };
}

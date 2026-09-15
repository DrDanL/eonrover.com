import { DEFENCES, GALAXY_COORDINATE_BOUNDS, SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';

export const FRIGATE_STRIKE_SPEED_PERCENT = 100;
export const FRIGATE_STRIKE_RESOLVER_VERSION = 'frigate-strike-v1';
export const FRIGATE_STRIKE_SAFETY_ROUND_CAP = 512;
export const MIN_FRIGATE_STRIKE_QUANTITY = 1;
export const MAX_FRIGATE_STRIKE_QUANTITY = 100;
export type FrigateStrikeCoordinates = { galaxy: number; system: number; slot: number };
export type FrigateStrikeTechnology = { weaponTech: number; shieldTech: number; armourTech: number };
export type FrigateStrikePlan = { ships: { frigate: number }; speedPercent: 100; outboundDurationSeconds: number; returnDurationSeconds: number; outboundFuelHeliox: number; returnFuelHeliox: number; timing: { arrivalAfterDepartureSeconds: number; returnAfterArrivalSeconds: number } };
export type FrigateStrikeResolution = { version: typeof FRIGATE_STRIKE_RESOLVER_VERSION; seedFingerprint: string; starting: { attacker: Record<string, number>; defender: Record<string, number> }; survivors: { attacker: Record<string, number>; defender: Record<string, number> }; losses: { attacker: Record<string, number>; defender: Record<string, number> }; rounds: Array<{ round: number; attackerLosses: Record<string, number>; defenderLosses: Record<string, number> }>; outcome: 'attacker' | 'defender' | 'draw' | 'unresolved'; termination: 'elimination' | 'stalemate' | 'safety-cap' };

export class FrigateStrikeError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'FrigateStrikeError'; } }
const fail = (code: string, message: string): never => { throw new FrigateStrikeError(code, message); };
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function coordinates(value: unknown): FrigateStrikeCoordinates {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'galaxy,slot,system' || !whole(value.galaxy) || !whole(value.system) || !whole(value.slot)
    || value.galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || value.galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || value.system < GALAXY_COORDINATE_BOUNDS.system.min || value.system > GALAXY_COORDINATE_BOUNDS.system.max
    || value.slot < GALAXY_COORDINATE_BOUNDS.slot.min || value.slot > GALAXY_COORDINATE_BOUNDS.slot.max) fail('INVALID_COORDINATES', 'Frigate strike coordinates are invalid.');
  return value as FrigateStrikeCoordinates;
}
/** Plans only fixed-speed Frigate travel from server-trusted coordinates. */
export function planFrigateStrike(input: unknown): FrigateStrikePlan {
  if (!record(input) || Object.keys(input).sort().join(',') !== 'fleetSpeed,origin,quantity,target') fail('INVALID_INPUT', 'Frigate strike planning input is invalid.');
  const values = input as Record<string, unknown>;
  const origin = coordinates(values.origin); const target = coordinates(values.target);
  if (origin.galaxy !== target.galaxy) fail('CROSS_GALAXY_TARGET', 'Frigate strikes must remain in one galaxy.');
  if (origin.system === target.system && origin.slot === target.slot) fail('IDENTICAL_COORDINATES', 'Frigate strike coordinates must differ.');
  if (!whole(values.quantity) || values.quantity < MIN_FRIGATE_STRIKE_QUANTITY || values.quantity > MAX_FRIGATE_STRIKE_QUANTITY) fail('INVALID_QUANTITY', 'Frigate quantity must be an integer from 1 through 100.');
  if (typeof values.fleetSpeed !== 'number' || !Number.isFinite(values.fleetSpeed) || values.fleetSpeed <= 0) fail('INVALID_FLEET_SPEED', 'Fleet speed is invalid.');
  const quantity = values.quantity as number; const fleetSpeed = values.fleetSpeed as number;
  const distance = distanceBetween(origin, target); const ships = { frigate: quantity };
  const duration = flightDurationSeconds(distance, SHIPS.frigate.speed, FRIGATE_STRIKE_SPEED_PERCENT, fleetSpeed);
  const fuel = fuelConsumption(ships, distance, duration);
  if (!Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(fuel) || fuel < 0) fail('INVALID_CALCULATION', 'Frigate strike planning is invalid.');
  return { ships, speedPercent: FRIGATE_STRIKE_SPEED_PERCENT, outboundDurationSeconds: duration, returnDurationSeconds: duration, outboundFuelHeliox: fuel, returnFuelHeliox: fuel, timing: { arrivalAfterDepartureSeconds: duration, returnAfterArrivalSeconds: duration } };
}
function technology(value: unknown): FrigateStrikeTechnology {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'armourTech,shieldTech,weaponTech' || !whole(value.weaponTech) || !whole(value.shieldTech) || !whole(value.armourTech)) fail('INVALID_TECHNOLOGY', 'Combat technology snapshot is invalid.');
  return value as FrigateStrikeTechnology;
}
type Unit = { key: string; attack: number; shield: number; hull: number };
function snapshot(values: unknown, definitions: Record<string, { attack: number; shield: number; armour: number }>, tech: FrigateStrikeTechnology): Unit[] {
  if (!record(values)) fail('INVALID_FORCES', 'Combat force snapshot is invalid.'); const result: Unit[] = [];
  const force = values as Record<string, unknown>;
  for (const key of Object.keys(force).sort()) {
    const count = force[key]; const definition = definitions[key];
    if (!definition || !whole(count) || count > 10_000) fail('INVALID_FORCES', 'Combat force snapshot is invalid.');
    for (let index = 0; index < (count as number); index += 1) result.push({ key, attack: definition.attack * (1 + tech.weaponTech * 0.1), shield: definition.shield * (1 + tech.shieldTech * 0.1), hull: definition.armour * (1 + tech.armourTech * 0.1) });
  }
  return result;
}
function rng(seed: string): () => number { let value = 2166136261; for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return () => { value += 0x6D2B79F5; let next = value; next = Math.imul(next ^ (next >>> 15), next | 1); next ^= next + Math.imul(next ^ (next >>> 7), next | 61); return ((next ^ (next >>> 14)) >>> 0) / 4294967296; }; }
function fingerprint(seed: string) { let value = 0; for (const char of seed) value = (value * 31 + char.charCodeAt(0)) >>> 0; return value.toString(16).padStart(8, '0'); }
function counts(units: Unit[]) { const value: Record<string, number> = {}; for (const unit of units) value[unit.key] = (value[unit.key] ?? 0) + 1; return value; }
function losses(start: Record<string, number>, remaining: Record<string, number>) { const value: Record<string, number> = {}; for (const key of Object.keys(start)) { const loss = start[key] - (remaining[key] ?? 0); if (loss) value[key] = loss; } return value; }
const damages = (shooters: Unit[], targets: Unit[]) => shooters.some((shooter) => targets.some((target) => shooter.attack > target.shield));
function fire(random: () => number, shooters: Unit[], targets: Unit[]) { for (const shooter of shooters) { if (!targets.length) break; const target = targets[Math.floor(random() * targets.length)]; target.hull -= Math.max(0, shooter.attack - target.shield); } }
/** Separate, persisted Frigate policy. It deliberately leaves Corvette v1/v2 untouched. */
export function resolveFrigateStrike(input: unknown): FrigateStrikeResolution {
  if (!record(input) || Object.keys(input).sort().join(',') !== 'attacker,defender,seed,version' || input.version !== FRIGATE_STRIKE_RESOLVER_VERSION || typeof input.seed !== 'string') fail('INVALID_INPUT', 'Frigate strike resolution input is invalid.');
  const values = input as Record<string, unknown>;
  if (!record(values.attacker)) fail('INVALID_FORCES', 'Frigate attacker snapshot is invalid.');
  const attacker = values.attacker as Record<string, unknown>;
  if (Object.keys(attacker).sort().join(',') !== 'frigates,technology' || !whole(attacker.frigates) || attacker.frigates < 1 || attacker.frigates > MAX_FRIGATE_STRIKE_QUANTITY) fail('INVALID_FORCES', 'Frigate attacker snapshot is invalid.');
  if (!record(values.defender)) fail('INVALID_FORCES', 'Frigate defender snapshot is invalid.');
  const defender = values.defender as Record<string, unknown>;
  if (Object.keys(defender).sort().join(',') !== 'defences,ships,technology') fail('INVALID_FORCES', 'Frigate defender snapshot is invalid.');
  let attackers = snapshot({ frigate: attacker.frigates as number }, { frigate: SHIPS.frigate }, technology(attacker.technology));
  let defenders = [...snapshot(defender.ships, SHIPS, technology(defender.technology)), ...snapshot(defender.defences, DEFENCES, technology(defender.technology))];
  const starting = { attacker: counts(attackers), defender: counts(defenders) }; const rounds: FrigateStrikeResolution['rounds'] = []; const random = rng(values.seed as string); let termination: FrigateStrikeResolution['termination'] = 'elimination';
  for (let round = 1; round <= FRIGATE_STRIKE_SAFETY_ROUND_CAP && attackers.length && defenders.length; round += 1) {
    if (!damages(attackers, defenders) && !damages(defenders, attackers)) { termination = 'stalemate'; break; }
    fire(random, attackers, defenders); fire(random, defenders, attackers);
    const beforeA = counts(attackers); const beforeD = counts(defenders); attackers = attackers.filter((unit) => unit.hull > 0); defenders = defenders.filter((unit) => unit.hull > 0);
    rounds.push({ round, attackerLosses: losses(beforeA, counts(attackers)), defenderLosses: losses(beforeD, counts(defenders)) });
    if (!attackers.length || !defenders.length) { termination = 'elimination'; break; }
    if (round === FRIGATE_STRIKE_SAFETY_ROUND_CAP) termination = 'safety-cap';
  }
  const survivors = { attacker: counts(attackers), defender: counts(defenders) };
  return { version: FRIGATE_STRIKE_RESOLVER_VERSION, seedFingerprint: fingerprint(values.seed as string), starting, survivors, losses: { attacker: losses(starting.attacker, survivors.attacker), defender: losses(starting.defender, survivors.defender) }, rounds, outcome: termination === 'safety-cap' ? 'unresolved' : attackers.length && !defenders.length ? 'attacker' : defenders.length && !attackers.length ? 'defender' : 'draw', termination };
}

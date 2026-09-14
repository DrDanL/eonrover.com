import { DEFENCES, GALAXY_COORDINATE_BOUNDS, SHIPS } from './constants';
import { distanceBetween, flightDurationSeconds, fuelConsumption } from './formulas';

export const CORVETTE_STRIKE_SPEED_PERCENT = 100;
export const CORVETTE_STRIKE_RESOLVER_VERSION = 'corvette-strike-v1';
export const MIN_CORVETTE_STRIKE_QUANTITY = 1;
export const MAX_CORVETTE_STRIKE_QUANTITY = 100;

export type CorvetteStrikeCoordinates = { galaxy: number; system: number; slot: number };
export type CorvetteStrikePlan = {
  ships: { corvette: number };
  speedPercent: typeof CORVETTE_STRIKE_SPEED_PERCENT;
  outboundDurationSeconds: number;
  returnDurationSeconds: number;
  outboundFuelHeliox: number;
  returnFuelHeliox: number;
  timing: { arrivalAfterDepartureSeconds: number; returnAfterArrivalSeconds: number };
};
export type CorvetteStrikePlanErrorCode = 'INVALID_INPUT' | 'INVALID_COORDINATES' | 'IDENTICAL_COORDINATES' | 'CROSS_GALAXY_TARGET' | 'INVALID_QUANTITY' | 'INVALID_FLEET_SPEED' | 'INVALID_CALCULATION';
export class CorvetteStrikePlanError extends Error { constructor(public readonly code: CorvetteStrikePlanErrorCode, message: string) { super(message); this.name = 'CorvetteStrikePlanError'; } }
function fail(code: CorvetteStrikePlanErrorCode, message: string): never { throw new CorvetteStrikePlanError(code, message); }
function coordinates(value: unknown): CorvetteStrikeCoordinates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_COORDINATES', 'Strike coordinates must be bounded integers.');
  const record = value as Record<string, unknown>; const keys = Object.keys(record).sort(); const expected = ['galaxy', 'slot', 'system'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return fail('INVALID_COORDINATES', 'Strike coordinates must contain exactly galaxy, system, and slot.');
  const { galaxy, system, slot } = record;
  if (typeof galaxy !== 'number' || typeof system !== 'number' || typeof slot !== 'number' || !Number.isSafeInteger(galaxy) || !Number.isSafeInteger(system) || !Number.isSafeInteger(slot)
    || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max) return fail('INVALID_COORDINATES', 'Strike coordinates are outside the canonical Galaxy bounds.');
  return { galaxy, system, slot };
}
/** Plans only trusted, fixed-speed Corvette travel; every combat input stays server-side. */
export function planCorvetteStrike(input: unknown): CorvetteStrikePlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_INPUT', 'Strike input is invalid.');
  const record = input as Record<string, unknown>; const keys = Object.keys(record).sort(); const expected = ['fleetSpeed', 'origin', 'quantity', 'target'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return fail('INVALID_INPUT', 'Strike planning accepts only origin, target, quantity, and trusted fleet speed.');
  const origin = coordinates(record.origin); const target = coordinates(record.target);
  if (origin.galaxy !== target.galaxy) return fail('CROSS_GALAXY_TARGET', 'Strike targets must be in the same galaxy.');
  if (origin.system === target.system && origin.slot === target.slot) return fail('IDENTICAL_COORDINATES', 'Strike origin and target must be distinct.');
  if (typeof record.quantity !== 'number' || !Number.isSafeInteger(record.quantity) || record.quantity < MIN_CORVETTE_STRIKE_QUANTITY || record.quantity > MAX_CORVETTE_STRIKE_QUANTITY) return fail('INVALID_QUANTITY', 'Corvette quantity must be an integer from 1 through 100.');
  if (typeof record.fleetSpeed !== 'number' || !Number.isFinite(record.fleetSpeed) || record.fleetSpeed <= 0) return fail('INVALID_FLEET_SPEED', 'Strike fleet speed must be finite and positive.');
  const ships = { corvette: record.quantity }; const distance = distanceBetween(origin, target);
  const outboundDurationSeconds = flightDurationSeconds(distance, SHIPS.corvette.speed, CORVETTE_STRIKE_SPEED_PERCENT, record.fleetSpeed);
  const outboundFuelHeliox = fuelConsumption(ships, distance, outboundDurationSeconds);
  if (!Number.isSafeInteger(outboundDurationSeconds) || outboundDurationSeconds <= 0 || !Number.isSafeInteger(outboundFuelHeliox) || outboundFuelHeliox < 0) return fail('INVALID_CALCULATION', 'Strike planning produced invalid travel values.');
  return { ships, speedPercent: CORVETTE_STRIKE_SPEED_PERCENT, outboundDurationSeconds, returnDurationSeconds: outboundDurationSeconds, outboundFuelHeliox, returnFuelHeliox: outboundFuelHeliox, timing: { arrivalAfterDepartureSeconds: outboundDurationSeconds, returnAfterArrivalSeconds: outboundDurationSeconds } };
}

export type CorvetteStrikeTechnology = { weaponTech: number; shieldTech: number; armourTech: number };
export type CorvetteStrikeForces = { ships: Record<string, number>; defences: Record<string, number>; technology: CorvetteStrikeTechnology };
export type CorvetteStrikeResolutionInput = { version: typeof CORVETTE_STRIKE_RESOLVER_VERSION; seed: string; attacker: { corvettes: number; technology: CorvetteStrikeTechnology }; defender: CorvetteStrikeForces };
export type CorvetteStrikeResolution = { version: typeof CORVETTE_STRIKE_RESOLVER_VERSION; seedFingerprint: string; starting: { attacker: Record<string, number>; defender: Record<string, number> }; survivors: { attacker: Record<string, number>; defender: Record<string, number> }; losses: { attacker: Record<string, number>; defender: Record<string, number> }; rounds: Array<{ round: number; attackerLosses: Record<string, number>; defenderLosses: Record<string, number> }>; outcome: 'attacker' | 'defender' | 'draw' };
export class CorvetteStrikeResolutionError extends Error { constructor(message: string) { super(message); this.name = 'CorvetteStrikeResolutionError'; } }
type Unit = { key: string; owner: 'attacker' | 'defender'; attack: number; shield: number; hull: number };
function validCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000; }
function technology(value: unknown): CorvetteStrikeTechnology {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CorvetteStrikeResolutionError('Combat technology snapshot is invalid.');
  const candidate = value as Record<string, unknown>; const keys = Object.keys(candidate).sort(); const expected = ['armourTech', 'shieldTech', 'weaponTech'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) || !expected.every((key) => validCount(candidate[key]))) throw new CorvetteStrikeResolutionError('Combat technology snapshot is invalid.');
  return candidate as CorvetteStrikeTechnology;
}
function randomFromSeed(seed: string): () => number {
  if (!seed || typeof seed !== 'string' || seed.length > 512) throw new CorvetteStrikeResolutionError('Combat seed is invalid.');
  let state = 2166136261; for (let i = 0; i < seed.length; i += 1) { state ^= seed.charCodeAt(i); state = Math.imul(state, 16777619); }
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) / 0x1_0000_0000); };
}
function seedFingerprint(seed: string): string { let value = 2166136261; for (let i = 0; i < seed.length; i += 1) { value ^= seed.charCodeAt(i); value = Math.imul(value, 16777619); } return (value >>> 0).toString(16).padStart(8, '0'); }
function snapshotUnits(values: Record<string, unknown>, definitions: Record<string, { attack: number; shield: number; armour: number }>, owner: 'attacker' | 'defender', tech: CorvetteStrikeTechnology): Unit[] {
  const units: Unit[] = []; const keys = Object.keys(values).sort();
  for (const key of keys) {
    if (!(key in definitions) || !validCount(values[key])) throw new CorvetteStrikeResolutionError('Combat force snapshot is invalid.');
    const definition = definitions[key]; const count = values[key] as number;
    const attack = definition.attack * (1 + tech.weaponTech * 0.1); const shield = definition.shield * (1 + tech.shieldTech * 0.1); const hull = definition.armour * (1 + tech.armourTech * 0.1);
    if (![attack, shield, hull].every(Number.isFinite) || attack < 0 || shield < 0 || hull <= 0) throw new CorvetteStrikeResolutionError('Combat statistics are invalid.');
    for (let index = 0; index < count; index += 1) units.push({ key, owner, attack, shield, hull });
  }
  return units;
}
function counts(units: Unit[]): Record<string, number> { const result: Record<string, number> = {}; for (const unit of units) result[unit.key] = (result[unit.key] ?? 0) + 1; return result; }
function subtract(starting: Record<string, number>, survivors: Record<string, number>): Record<string, number> { const result: Record<string, number> = {}; for (const key of Object.keys(starting).sort()) { const loss = starting[key] - (survivors[key] ?? 0); if (loss > 0) result[key] = loss; } return result; }
/** Deterministic v1 battle resolver. It accepts only complete explicit snapshots and a server seed. */
export function resolveCorvetteStrike(input: unknown): CorvetteStrikeResolution {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CorvetteStrikeResolutionError('Combat resolution input is invalid.');
  const value = input as Record<string, unknown>; const keys = Object.keys(value).sort(); const expected = ['attacker', 'defender', 'seed', 'version'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) || value.version !== CORVETTE_STRIKE_RESOLVER_VERSION || !value.attacker || !value.defender || typeof value.seed !== 'string') throw new CorvetteStrikeResolutionError('Combat resolution input is invalid.');
  const attacker = value.attacker as Record<string, unknown>; const defender = value.defender as Record<string, unknown>;
  if (Object.keys(attacker).sort().join(',') !== 'corvettes,technology' || !validCount(attacker.corvettes) || attacker.corvettes < 1 || attacker.corvettes > MAX_CORVETTE_STRIKE_QUANTITY || Object.keys(defender).sort().join(',') !== 'defences,ships,technology' || !defender.ships || !defender.defences || typeof defender.ships !== 'object' || typeof defender.defences !== 'object') throw new CorvetteStrikeResolutionError('Combat force snapshot is invalid.');
  const attackerTech = technology(attacker.technology); const defenderTech = technology(defender.technology); const random = randomFromSeed(value.seed);
  let attacking = snapshotUnits({ corvette: attacker.corvettes }, { corvette: SHIPS.corvette }, 'attacker', attackerTech);
  let defending = [...snapshotUnits(defender.ships as Record<string, unknown>, SHIPS, 'defender', defenderTech), ...snapshotUnits(defender.defences as Record<string, unknown>, DEFENCES, 'defender', defenderTech)];
  const starting = { attacker: counts(attacking), defender: counts(defending) }; const rounds: CorvetteStrikeResolution['rounds'] = [];
  for (let round = 1; round <= 6 && attacking.length && defending.length; round += 1) {
    const fire = (shooters: Unit[], targets: Unit[]) => { for (const shooter of shooters) { if (!targets.length) break; const target = targets[Math.floor(random() * targets.length)]; target.hull -= Math.max(0, shooter.attack - target.shield); } };
    fire(attacking, defending); fire(defending, attacking);
    const beforeAttacker = counts(attacking); const beforeDefender = counts(defending); attacking = attacking.filter((unit) => unit.hull > 0); defending = defending.filter((unit) => unit.hull > 0);
    rounds.push({ round, attackerLosses: subtract(beforeAttacker, counts(attacking)), defenderLosses: subtract(beforeDefender, counts(defending)) });
  }
  const survivors = { attacker: counts(attacking), defender: counts(defending) }; const outcome = attacking.length && !defending.length ? 'attacker' : defending.length && !attacking.length ? 'defender' : 'draw';
  return { version: CORVETTE_STRIKE_RESOLVER_VERSION, seedFingerprint: seedFingerprint(value.seed), starting, survivors, losses: { attacker: subtract(starting.attacker, survivors.attacker), defender: subtract(starting.defender, survivors.defender) }, rounds, outcome };
}

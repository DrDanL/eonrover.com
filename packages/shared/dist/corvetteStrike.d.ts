export declare const CORVETTE_STRIKE_SPEED_PERCENT = 100;
/**
 * New launches use v2. v1 remains supported solely so an already-accepted
 * mission always completes under the resolver it persisted at launch.
 */
export declare const CORVETTE_STRIKE_V1_RESOLVER_VERSION = "corvette-strike-v1";
export declare const CORVETTE_STRIKE_RESOLVER_VERSION = "corvette-strike-v2";
export type CorvetteStrikeResolverVersion = typeof CORVETTE_STRIKE_V1_RESOLVER_VERSION | typeof CORVETTE_STRIKE_RESOLVER_VERSION;
/**
 * v2 continues until elimination or a verified no-damage stalemate. This is
 * deliberately far above the 172 uninterrupted Corvette hits needed to break
 * one current Rail Battery, while still bounding malformed/extreme snapshots.
 */
export declare const CORVETTE_STRIKE_V2_SAFETY_ROUND_CAP = 512;
export declare const MIN_CORVETTE_STRIKE_QUANTITY = 1;
export declare const MAX_CORVETTE_STRIKE_QUANTITY = 100;
export type CorvetteStrikeCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
export type CorvetteStrikePlan = {
    ships: {
        corvette: number;
    };
    speedPercent: typeof CORVETTE_STRIKE_SPEED_PERCENT;
    outboundDurationSeconds: number;
    returnDurationSeconds: number;
    outboundFuelHeliox: number;
    returnFuelHeliox: number;
    timing: {
        arrivalAfterDepartureSeconds: number;
        returnAfterArrivalSeconds: number;
    };
};
export type CorvetteStrikePlanErrorCode = 'INVALID_INPUT' | 'INVALID_COORDINATES' | 'IDENTICAL_COORDINATES' | 'CROSS_GALAXY_TARGET' | 'INVALID_QUANTITY' | 'INVALID_FLEET_SPEED' | 'INVALID_CALCULATION';
export declare class CorvetteStrikePlanError extends Error {
    readonly code: CorvetteStrikePlanErrorCode;
    constructor(code: CorvetteStrikePlanErrorCode, message: string);
}
/** Plans only trusted, fixed-speed Corvette travel; every combat input stays server-side. */
export declare function planCorvetteStrike(input: unknown): CorvetteStrikePlan;
export type CorvetteStrikeTechnology = {
    weaponTech: number;
    shieldTech: number;
    armourTech: number;
};
export type CorvetteStrikeForces = {
    ships: Record<string, number>;
    defences: Record<string, number>;
    technology: CorvetteStrikeTechnology;
};
export type CorvetteStrikeResolutionInput = {
    version: CorvetteStrikeResolverVersion;
    seed: string;
    attacker: {
        corvettes: number;
        technology: CorvetteStrikeTechnology;
    };
    defender: CorvetteStrikeForces;
};
export type CorvetteStrikeResolution = {
    version: CorvetteStrikeResolverVersion;
    seedFingerprint: string;
    starting: {
        attacker: Record<string, number>;
        defender: Record<string, number>;
    };
    survivors: {
        attacker: Record<string, number>;
        defender: Record<string, number>;
    };
    losses: {
        attacker: Record<string, number>;
        defender: Record<string, number>;
    };
    rounds: Array<{
        round: number;
        attackerLosses: Record<string, number>;
        defenderLosses: Record<string, number>;
    }>;
    outcome: 'attacker' | 'defender' | 'draw' | 'unresolved';
    termination?: 'elimination' | 'stalemate' | 'safety-cap';
};
export declare class CorvetteStrikeResolutionError extends Error {
    constructor(message: string);
}
export declare function isCorvetteStrikeResolverVersion(value: unknown): value is CorvetteStrikeResolverVersion;
/** Resolves only an explicit persisted-version snapshot under its matching policy. */
export declare function resolveCorvetteStrike(input: unknown): CorvetteStrikeResolution;

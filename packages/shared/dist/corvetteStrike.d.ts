export declare const CORVETTE_STRIKE_SPEED_PERCENT = 100;
export declare const CORVETTE_STRIKE_RESOLVER_VERSION = "corvette-strike-v1";
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
    version: typeof CORVETTE_STRIKE_RESOLVER_VERSION;
    seed: string;
    attacker: {
        corvettes: number;
        technology: CorvetteStrikeTechnology;
    };
    defender: CorvetteStrikeForces;
};
export type CorvetteStrikeResolution = {
    version: typeof CORVETTE_STRIKE_RESOLVER_VERSION;
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
    outcome: 'attacker' | 'defender' | 'draw';
};
export declare class CorvetteStrikeResolutionError extends Error {
    constructor(message: string);
}
/** Deterministic v1 battle resolver. It accepts only complete explicit snapshots and a server seed. */
export declare function resolveCorvetteStrike(input: unknown): CorvetteStrikeResolution;

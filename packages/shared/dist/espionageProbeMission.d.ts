/** Espionage Probe travel is deliberately fixed; disclosure rules come later. */
export declare const ESPIONAGE_PROBE_SPEED_PERCENT = 100;
export type EspionageProbeCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
export type EspionageProbePlanErrorCode = 'INVALID_INPUT' | 'INVALID_COORDINATES' | 'IDENTICAL_COORDINATES' | 'CROSS_GALAXY_TARGET' | 'INVALID_FLEET_SPEED' | 'INVALID_CALCULATION';
/** Stable validation error for later service-layer error mapping. */
export declare class EspionageProbePlanError extends Error {
    readonly code: EspionageProbePlanErrorCode;
    constructor(code: EspionageProbePlanErrorCode, message: string);
}
export type EspionageProbePlan = {
    ships: {
        probe: 1;
    };
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
/**
 * Plans the future intelligence-only Probe journey from server-resolved
 * coordinates. It accepts neither caller-selected ships, cargo, speed, timing,
 * report accuracy, nor a target identity.
 */
export declare function planEspionageProbeMission(input: unknown): EspionageProbePlan;

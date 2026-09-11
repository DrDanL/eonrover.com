import { ResourceAmounts } from './types';
export declare const TRANSPORT_SPEED_PERCENT = 100;
export declare const MIN_TRANSPORTER_QUANTITY = 1;
export declare const MAX_TRANSPORTER_QUANTITY = 100;
export type TransportCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
export type TransportPlanErrorCode = 'INVALID_INPUT' | 'INVALID_COORDINATES' | 'IDENTICAL_COORDINATES' | 'INVALID_QUANTITY' | 'INVALID_CARGO' | 'EMPTY_CARGO' | 'CARGO_CAPACITY_EXCEEDED' | 'INVALID_FLEET_SPEED' | 'INVALID_CALCULATION';
/** A stable error for callers that need to map invalid transport commands. */
export declare class TransportPlanError extends Error {
    readonly code: TransportPlanErrorCode;
    constructor(code: TransportPlanErrorCode, message: string);
}
export type TransportMissionPlan = {
    ships: {
        transporter: number;
    };
    speedPercent: typeof TRANSPORT_SPEED_PERCENT;
    cargo: ResourceAmounts;
    cargoCapacity: number;
    usedCargoCapacity: number;
    remainingCargoCapacity: number;
    outboundDurationSeconds: number;
    returnDurationSeconds: number;
    outboundFuelHeliox: number;
    returnFuelHeliox: number;
    totalReservedFuelHeliox: number;
    timing: {
        arrivalAfterDepartureSeconds: number;
        returnAfterArrivalSeconds: number;
    };
};
/**
 * Plans the deliberately narrow first transport journey. It validates only
 * caller-independent command shape; ownership, stock, fuel reservation, and
 * destination storage remain transaction concerns for later stages.
 */
export declare function planTransportMission(input: unknown): TransportMissionPlan;

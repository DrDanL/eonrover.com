import { PlanetType } from './types';
export declare const COLONIZATION_SPEED_PERCENT = 100;
export declare const COLONIZATION_MIN_SLOT = 1;
export declare const COLONIZATION_MAX_SLOT = 12;
export type ColonizationCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
export type ColonizationPlan = {
    target: ColonizationCoordinates;
    ships: {
        colonyShip: 1;
    };
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
/**
 * Plans only the bounded, same-system colony mission. The caller can select
 * neither speed nor cargo; all values returned here are derived from server
 * coordinates, the fixed Colony Ship definition, and the configured fleet
 * speed.
 */
export declare function planSameSystemColonization(input: ColonizationPlannerInput): ColonizationPlan;
/**
 * Derives a stable, server-persistable environmental profile from the mission
 * identifier. Completion consumes the accepted snapshot and never randomises
 * an arriving colony.
 */
export declare function deriveColonyCharacteristics(missionId: string): ColonyCharacteristics;

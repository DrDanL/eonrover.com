import { BuildingKey, DefenceKey, PlanetType, ResourceAmounts, ShipKey } from './types';
/**
 * `espionageAccuracy` is bounded to 0.1 through 1.0. These thresholds divide
 * that score into deterministic, named disclosure tiers without changing the
 * underlying research formula or any balance value.
 */
export declare const ESPIONAGE_DISCLOSURE_TIER_THRESHOLDS: Readonly<{
    RESOURCES: 0.4;
    BUILDINGS: 0.6;
    FORCES: 0.8;
}>;
export type EspionageDisclosureTier = 'IDENTITY' | 'RESOURCES' | 'BUILDINGS' | 'FORCES';
export type EspionageTargetCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
/**
 * A deliberately settled, minimal target snapshot. Callers must construct it
 * from authoritative state before asking the pure policy to project a report.
 */
export type EspionageDisclosureTargetSnapshot = {
    publicIdentity: {
        coordinates: EspionageTargetCoordinates;
        planetName: string;
        planetType: PlanetType;
        ownerUsername: string;
    };
    resources: ResourceAmounts;
    completedBuildings: Partial<Record<BuildingKey, number>>;
    ships: Partial<Record<ShipKey, number>>;
    defences: Partial<Record<DefenceKey, number>>;
};
export type EspionageDisclosureInput = {
    attackerEspionageTechnology: number;
    defenderEspionageTechnology: number;
    target: EspionageDisclosureTargetSnapshot;
};
export type EspionagePublicTargetIdentity = EspionageDisclosureTargetSnapshot['publicIdentity'];
export type EspionageDisclosureReport = {
    target: EspionagePublicTargetIdentity;
    tier: EspionageDisclosureTier;
    resources?: ResourceAmounts;
    buildings?: Partial<Record<BuildingKey, number>>;
    ships?: Partial<Record<ShipKey, number>>;
    defences?: Partial<Record<DefenceKey, number>>;
};
export type EspionageDisclosureErrorCode = 'INVALID_INPUT' | 'INVALID_TECHNOLOGY_LEVEL' | 'INVALID_TARGET_SNAPSHOT' | 'INVALID_ACCURACY';
export declare class EspionageDisclosureError extends Error {
    readonly code: EspionageDisclosureErrorCode;
    constructor(code: EspionageDisclosureErrorCode, message: string);
}
/** Maps an already calculated accuracy score to a public disclosure tier. */
export declare function espionageDisclosureTierForAccuracy(accuracy: number): EspionageDisclosureTier;
/**
 * Projects a deterministic, privacy-safe report from an already-authoritative
 * snapshot. The policy builds every tier from explicit allowlists and never
 * serialises arbitrary input data.
 */
export declare function discloseEspionageTarget(input: unknown): EspionageDisclosureReport;

import { PlanetEnvironment, ResourceAmounts } from './types';
export declare const BUILD_COMPLETION_JOB_NAME = "complete-building";
export declare const BUILD_COMPLETION_TRANSACTION_ATTEMPTS = 3;
export declare function buildCompletionJobId(constructionId: string): string;
export interface BuildingCompletionConstruction {
    id: string;
    planetId: string;
    buildingKey: string;
    targetLevel: number;
    completesAt: Date;
    status: 'PENDING' | 'COMPLETE' | 'CANCELLED';
}
export interface BuildingCompletionPlanet {
    id: string;
    ownerId: string;
    name: string;
    resources: ResourceAmounts;
    lastProductionAt: Date;
    environment: PlanetEnvironment;
}
export interface BuildingCompletionBuilding {
    key: string;
    level: number;
}
export interface BuildingCompletionTransaction {
    findConstruction(constructionId: string): Promise<BuildingCompletionConstruction | null>;
    lockPlanet(planetId: string): Promise<BuildingCompletionPlanet | null>;
    lockConstruction(constructionId: string, planetId: string): Promise<BuildingCompletionConstruction | null>;
    listBuildings(planetId: string): Promise<BuildingCompletionBuilding[]>;
    markConstructionComplete(constructionId: string): Promise<boolean>;
    updatePlanetResources(planetId: string, resources: ResourceAmounts, lastProductionAt: Date): Promise<void>;
    setBuildingLevel(planetId: string, buildingKey: string, level: number): Promise<void>;
    createCompletionNotification(userId: string, message: string): Promise<void>;
}
export interface BuildingCompletionStore {
    transaction<T>(operation: (tx: BuildingCompletionTransaction) => Promise<T>): Promise<T>;
    isRetryableTransactionError(error: unknown): boolean;
}
export type BuildingCompletionResult = {
    outcome: 'missing';
} | {
    outcome: 'already-complete';
} | {
    outcome: 'cancelled';
} | {
    outcome: 'too-early';
    completesAt: Date;
} | {
    outcome: 'completed';
    legacyPastFinish: boolean;
};
export declare class BuildingCompletionInvariantError extends Error {
    constructor(message: string);
}
/**
 * Completes one persisted building construction. PostgreSQL adapters provide
 * the transaction and row locks; this shared operation owns the transition,
 * idempotency checks, production split, and notification write order.
 */
export declare function completeBuildingConstruction(store: BuildingCompletionStore, constructionId: string, processingTime: Date, economySpeed: number): Promise<BuildingCompletionResult>;

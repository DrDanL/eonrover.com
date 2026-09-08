/** The Prisma surface used by canonical deploy-arrival completion. */
export interface DeployArrivalCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}
export type DeployArrivalCompletionOutcome = 'completed' | 'early' | 'noop' | 'unavailable';
/**
 * Completes only a persisted canonical owned-planet DEPLOY arrival. The
 * database is authoritative: callers supply only the mission id and a time
 * boundary. BullMQ payloads, legacy mission JSON, and job ids are never used
 * as game state.
 */
export declare function completeOwnedPlanetDeployArrival(database: DeployArrivalCompletionDatabase, missionId: string, currentTime?: Date): Promise<DeployArrivalCompletionOutcome>;

/** The minimal Prisma-like surface used by canonical colonisation completion. */
export interface ColonizationArrivalCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
    fleetMission: any;
}
export type ColonizationCompletionOutcome = 'completed' | 'failed' | 'early' | 'noop' | 'unavailable';
/**
 * The single PostgreSQL-authoritative canonical colonisation arrival path.
 * Callers provide only a mission identifier and a time boundary; legacy JSON
 * and all queued data are intentionally excluded from this authority source.
 */
export declare function completeCanonicalColonization(database: ColonizationArrivalCompletionDatabase, missionId: string, currentTime?: Date): Promise<ColonizationCompletionOutcome>;

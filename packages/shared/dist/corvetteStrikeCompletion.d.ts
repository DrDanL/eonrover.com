export type CorvetteStrikeCompletionOutcome = 'arrived' | 'returned' | 'early' | 'noop' | 'unavailable';
export interface CorvetteStrikeCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}
export interface CorvetteStrikeCompletionOptions {
    scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}
/**
 * Settles only persisted canonical Corvette strikes. It never consults legacy
 * Fleet JSON, queued payloads, or caller combat values; all state is locked
 * and reloaded from PostgreSQL inside the serializable transaction.
 */
export declare function settleCanonicalCorvetteStrike(database: CorvetteStrikeCompletionDatabase, missionId: string, currentTime?: Date, options?: CorvetteStrikeCompletionOptions): Promise<CorvetteStrikeCompletionOutcome>;

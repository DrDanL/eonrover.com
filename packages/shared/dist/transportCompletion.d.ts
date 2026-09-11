export type TransportCompletionOutcome = 'delivered' | 'awaiting-capacity' | 'returned' | 'early' | 'noop' | 'unavailable';
export interface TransportCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}
export interface TransportCompletionOptions {
    scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}
/**
 * The single PostgreSQL-authoritative transport state transition. Redis is
 * deliberately absent from this transaction; callers may attach a best-effort
 * post-commit return wake-up after a delivery has committed.
 */
export declare function settleCanonicalTransport(database: TransportCompletionDatabase, missionId: string, currentTime?: Date, options?: TransportCompletionOptions): Promise<TransportCompletionOutcome>;

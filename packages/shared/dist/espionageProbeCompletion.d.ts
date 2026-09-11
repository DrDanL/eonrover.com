/** The minimal Prisma-like surface used by canonical Probe completion. */
export interface EspionageProbeCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}
export interface EspionageProbeCompletionOptions {
    scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}
export type EspionageProbeCompletionOutcome = 'arrived' | 'returned' | 'early' | 'noop' | 'unavailable';
/**
 * Settles only a persisted canonical Espionage Probe lifecycle. The caller
 * provides a mission id and authoritative time boundary; legacy JSON, queued
 * payload data, and client values are intentionally not game-state inputs.
 */
export declare function settleCanonicalEspionageProbe(database: EspionageProbeCompletionDatabase, missionId: string, currentTime?: Date, options?: EspionageProbeCompletionOptions): Promise<EspionageProbeCompletionOutcome>;

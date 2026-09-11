export interface CoordinateLockCoordinate {
    galaxy: number;
    system: number;
    slot: number;
}
interface AdvisoryLockTransaction {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}
/**
 * A stable advisory-lock key for one exact coordinate. Hash collisions are
 * harmless: callers still verify the complete coordinate before writing.
 */
export declare function coordinateAdvisoryLockKey(coordinate: CoordinateLockCoordinate): bigint;
/** Acquires the transaction-scoped coordinate lock used by all trusted claims. */
export declare function lockCoordinateForTransaction(tx: AdvisoryLockTransaction, coordinate: CoordinateLockCoordinate): Promise<void>;
export {};

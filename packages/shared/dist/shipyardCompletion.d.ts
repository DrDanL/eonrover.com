/** The Prisma surface used by Shipyard completion.  PostgreSQL is the source
 * of truth; BullMQ is deliberately only a wake-up mechanism. */
export interface ShipyardCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
    shipyardQueueItem: any;
}
export type ShipyardCompletionResult = 'missing' | 'cancelled' | 'complete' | 'too-early' | 'completed';
/**
 * Completes one persisted Shipyard batch exactly once.  Callers provide only
 * the queue id: ownership, item type, quantity, due time, and notification
 * recipient are all reloaded under the established account -> planet -> queue
 * lock order.
 */
export declare function completeShipyardBatch(database: ShipyardCompletionDatabase, queueItemId: string, now?: Date): Promise<ShipyardCompletionResult>;
export declare function completeDueShipyardForPlanet(database: ShipyardCompletionDatabase, planetId: string, now?: Date): Promise<void>;

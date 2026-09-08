/** The small Prisma surface used by the authoritative research-completion
 * transaction. Keeping it structural lets both API and worker use exactly the
 * same PostgreSQL transaction without coupling this shared package to either
 * application's Prisma singleton. */
export interface ResearchCompletionDatabase {
    $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
    researchQueueItem: any;
}
export type ResearchCompletionResult = 'missing' | 'cancelled' | 'complete' | 'too-early' | 'completed';
export declare function completeResearch(database: ResearchCompletionDatabase, queueItemId: string, now?: Date): Promise<ResearchCompletionResult>;
export declare function completeDueResearchForUser(database: ResearchCompletionDatabase, userId: string, now?: Date): Promise<void>;

export declare const COLONIZATION_ARRIVAL_JOB_NAME = "complete-colony-arrival";
export interface ColonizationArrivalJobData {
    missionId: string;
}
export type ColonizationArrivalSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface ColonizationArrivalSchedulingDatabase {
    fleetMission: any;
}
export interface ColonizationArrivalSchedulingQueue {
    getJob(jobId: string): Promise<{
        getState(): Promise<string>;
    } | undefined>;
    add(name: string, data: ColonizationArrivalJobData, options: {
        jobId: string;
        delay: number;
        removeOnComplete: boolean;
        attempts: number;
    }): Promise<unknown>;
}
export declare function colonizationArrivalJobId(missionId: string): string;
/**
 * Best-effort canonical colonisation wake-up scheduling from committed
 * PostgreSQL state. It deliberately reads no legacy mission JSON and never
 * mutates PostgreSQL: Redis is solely the deterministic wake-up channel.
 */
export declare function scheduleColonizationArrivalWakeup(database: ColonizationArrivalSchedulingDatabase, queue: ColonizationArrivalSchedulingQueue, missionId: string, currentTime?: Date): Promise<ColonizationArrivalSchedulingOutcome>;

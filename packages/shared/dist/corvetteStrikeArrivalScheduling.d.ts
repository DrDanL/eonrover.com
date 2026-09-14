export declare const CORVETTE_STRIKE_ARRIVAL_JOB_NAME = "complete-corvette-strike-arrival";
export declare const CORVETTE_STRIKE_RETURN_JOB_NAME = "complete-corvette-strike-return";
export type CorvetteStrikeArrivalJobData = {
    missionId: string;
};
export type CorvetteStrikeSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface CorvetteStrikeSchedulingQueue {
    getJob(jobId: string): Promise<{
        getState(): Promise<string>;
    } | undefined>;
    add(name: string, data: CorvetteStrikeArrivalJobData, options: {
        jobId: string;
        delay: number;
        removeOnComplete: boolean;
        attempts: number;
    }): Promise<unknown>;
}
export interface CorvetteStrikeSchedulingDatabase {
    fleetMission: any;
}
export declare const corvetteStrikeArrivalJobId: (missionId: string) => string;
export declare const corvetteStrikeReturnJobId: (missionId: string) => string;
export declare const scheduleCorvetteStrikeArrivalWakeup: (database: CorvetteStrikeSchedulingDatabase, queue: CorvetteStrikeSchedulingQueue, missionId: string, currentTime?: Date) => Promise<CorvetteStrikeSchedulingOutcome>;
export declare const scheduleCorvetteStrikeReturnWakeup: (database: CorvetteStrikeSchedulingDatabase, queue: CorvetteStrikeSchedulingQueue, missionId: string, currentTime?: Date) => Promise<CorvetteStrikeSchedulingOutcome>;

export declare const DEPLOY_ARRIVAL_JOB_NAME = "complete-deploy-arrival";
export interface DeployArrivalJobData {
    missionId: string;
}
export type DeployArrivalSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface DeployArrivalSchedulingDatabase {
    fleetMission: any;
}
export interface DeployArrivalSchedulingQueue {
    getJob(jobId: string): Promise<{
        getState(): Promise<string>;
    } | undefined>;
    add(name: string, data: DeployArrivalJobData, options: {
        jobId: string;
        delay: number;
        removeOnComplete: boolean;
        attempts: number;
    }): Promise<unknown>;
}
export declare function deployArrivalJobId(missionId: string): string;
/**
 * Best-effort deploy-arrival wake-up scheduling from committed canonical
 * PostgreSQL state. The database never changes here; Redis is only a
 * deterministic wake-up channel and retained terminal jobs are untouched.
 */
export declare function scheduleDeployArrivalWakeup(database: DeployArrivalSchedulingDatabase, queue: DeployArrivalSchedulingQueue, missionId: string, currentTime?: Date): Promise<DeployArrivalSchedulingOutcome>;

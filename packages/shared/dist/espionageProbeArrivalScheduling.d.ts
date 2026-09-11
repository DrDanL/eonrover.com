export declare const ESPIONAGE_PROBE_ARRIVAL_JOB_NAME = "complete-espionage-probe-arrival";
export declare const ESPIONAGE_PROBE_RETURN_JOB_NAME = "complete-espionage-probe-return";
export interface EspionageProbeArrivalJobData {
    missionId: string;
}
export type EspionageProbeSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface EspionageProbeSchedulingDatabase {
    fleetMission: any;
}
export interface EspionageProbeSchedulingQueue {
    getJob(jobId: string): Promise<{
        getState(): Promise<string>;
    } | undefined>;
    add(name: string, data: EspionageProbeArrivalJobData, options: {
        jobId: string;
        delay: number;
        removeOnComplete: boolean;
        attempts: number;
    }): Promise<unknown>;
}
export declare function espionageProbeArrivalJobId(missionId: string): string;
export declare function espionageProbeReturnJobId(missionId: string): string;
/** Schedules only a committed canonical outbound Probe arrival wake-up. */
export declare function scheduleEspionageProbeArrivalWakeup(database: EspionageProbeSchedulingDatabase, queue: EspionageProbeSchedulingQueue, missionId: string, currentTime?: Date): Promise<EspionageProbeSchedulingOutcome>;
/** Schedules only a committed canonical returning Probe wake-up. */
export declare function scheduleEspionageProbeReturnWakeup(database: EspionageProbeSchedulingDatabase, queue: EspionageProbeSchedulingQueue, missionId: string, currentTime?: Date): Promise<EspionageProbeSchedulingOutcome>;

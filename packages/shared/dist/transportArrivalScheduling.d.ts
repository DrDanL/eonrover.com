export declare const TRANSPORT_ARRIVAL_JOB_NAME = "complete-transport-arrival";
export declare const TRANSPORT_RETURN_JOB_NAME = "complete-transport-return";
export interface TransportArrivalJobData {
    missionId: string;
}
export type TransportSchedulingOutcome = 'scheduled' | 'existing' | 'retained-terminal' | 'ineligible' | 'failed';
export interface TransportSchedulingDatabase {
    fleetMission: any;
}
export interface TransportSchedulingQueue {
    getJob(jobId: string): Promise<{
        getState(): Promise<string>;
    } | undefined>;
    add(name: string, data: TransportArrivalJobData, options: {
        jobId: string;
        delay: number;
        removeOnComplete: boolean;
        attempts: number;
    }): Promise<unknown>;
}
export declare function transportArrivalJobId(missionId: string): string;
export declare function transportReturnJobId(missionId: string): string;
/** Schedules only a committed, canonical outbound transport arrival wake-up. */
export declare function scheduleTransportArrivalWakeup(database: TransportSchedulingDatabase, queue: TransportSchedulingQueue, missionId: string, currentTime?: Date): Promise<TransportSchedulingOutcome>;
/** Schedules only a committed, canonical returning-Transporter wake-up. */
export declare function scheduleTransportReturnWakeup(database: TransportSchedulingDatabase, queue: TransportSchedulingQueue, missionId: string, currentTime?: Date): Promise<TransportSchedulingOutcome>;

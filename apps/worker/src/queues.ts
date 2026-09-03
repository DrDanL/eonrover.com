import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const connection = createRedisConnection();

export const buildQueue = new Queue('build-queue', { connection });
export const researchQueue = new Queue('research-queue', { connection });
export const shipyardQueue = new Queue('shipyard-queue', { connection });
export const fleetQueue = new Queue('fleet-queue', { connection });

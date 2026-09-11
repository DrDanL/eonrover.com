import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const connection = createRedisConnection();

export const buildQueue = new Queue('build-queue', { connection });
export const researchQueue = new Queue('research-queue', { connection });
export const shipyardQueue = new Queue('shipyard-queue', { connection });
export const fleetQueue = new Queue('fleet-queue', { connection });
export const deployArrivalQueue = new Queue('deploy-arrival-queue', { connection });
// Canonical colonisation wake-ups are isolated from both the trusted deploy
// queue and the deliberately dormant legacy fleet queue.
export const colonizationArrivalQueue = new Queue('colonization-arrival-queue', { connection });
// Canonical transport wake-ups remain isolated from the deliberately dormant
// legacy fleet queue. Stage 10B5b has no transport reconciliation.
export const transportArrivalQueue = new Queue('transport-arrival-queue', { connection });

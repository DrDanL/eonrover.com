import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { getApiConfig } from '../config';

const config = getApiConfig();

export function createRedisConnection() {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

export const connection = createRedisConnection();

export const buildQueue = new Queue('build-queue', { connection });
export const researchQueue = new Queue('research-queue', { connection });
export const shipyardQueue = new Queue('shipyard-queue', { connection });
export const fleetQueue = new Queue('fleet-queue', { connection });
// Kept separate from the dormant legacy fleet queue so canonical deploy
// wake-ups can reach only the dedicated trusted processor.
export const deployArrivalQueue = new Queue('deploy-arrival-queue', { connection });

export const QUEUE_NAMES = {
  build: 'build-queue',
  research: 'research-queue',
  shipyard: 'shipyard-queue',
  fleet: 'fleet-queue',
  deployArrival: 'deploy-arrival-queue',
} as const;

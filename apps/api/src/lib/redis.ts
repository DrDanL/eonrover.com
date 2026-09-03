import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export function createRedisConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const connection = createRedisConnection();

export const buildQueue = new Queue('build-queue', { connection });
export const researchQueue = new Queue('research-queue', { connection });
export const shipyardQueue = new Queue('shipyard-queue', { connection });
export const fleetQueue = new Queue('fleet-queue', { connection });

export const QUEUE_NAMES = {
  build: 'build-queue',
  research: 'research-queue',
  shipyard: 'shipyard-queue',
  fleet: 'fleet-queue',
} as const;

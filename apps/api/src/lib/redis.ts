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
// Canonical colonisation wake-ups remain isolated from both the trusted deploy
// queue and the deliberately dormant legacy fleet queue.
export const colonizationArrivalQueue = new Queue('colonization-arrival-queue', { connection });
// Transport wake-ups remain isolated until a dedicated processor is added in
// a later stage; no consumer is registered here or in the worker.
export const transportArrivalQueue = new Queue('transport-arrival-queue', { connection });
// Canonical Probe wake-ups are deliberately isolated from the dormant legacy
// fleet queue. This stage registers no consumer for this queue.
export const espionageProbeArrivalQueue = new Queue('espionage-probe-arrival-queue', { connection });
export const corvetteStrikeArrivalQueue = new Queue('corvette-strike-arrival-queue', { connection });
export const frigateStrikeArrivalQueue = new Queue('frigate-strike-arrival-queue', { connection });

export const QUEUE_NAMES = {
  build: 'build-queue',
  research: 'research-queue',
  shipyard: 'shipyard-queue',
  fleet: 'fleet-queue',
  deployArrival: 'deploy-arrival-queue',
  colonizationArrival: 'colonization-arrival-queue',
  transportArrival: 'transport-arrival-queue',
  espionageProbeArrival: 'espionage-probe-arrival-queue',
  corvetteStrikeArrival: 'corvette-strike-arrival-queue',
  frigateStrikeArrival: 'frigate-strike-arrival-queue',
} as const;

import IORedis from 'ioredis';
import { getWorkerConfig } from './config';

const config = getWorkerConfig();

export function createRedisConnection() {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

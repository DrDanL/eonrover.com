import http from 'http';
import { getWorkerConfig } from './config';

const config = getWorkerConfig();
const { Worker } = require('bullmq') as typeof import('bullmq');
const { createRedisConnection } = require('./redis') as typeof import('./redis');
const { prisma } = require('./prisma') as typeof import('./prisma');
const { createHealthHandler } = require('./health') as typeof import('./health');
const { processBuildJob } = require('./processors/buildProcessor') as typeof import('./processors/buildProcessor');
const { processResearchJob } = require('./processors/researchProcessor') as typeof import('./processors/researchProcessor');
const { processShipyardJob } = require('./processors/shipyardProcessor') as typeof import('./processors/shipyardProcessor');
const { processFleetJob } = require('./processors/fleetProcessor') as typeof import('./processors/fleetProcessor');
const connection = createRedisConnection();

function logCompletion(name: string) {
  return (job: { id?: string }) => {
    // eslint-disable-next-line no-console
    console.log(`[${name}] completed job ${job.id}`);
  };
}

function logFailure(name: string) {
  return (job: { id?: string } | undefined, err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`[${name}] job ${job?.id} failed:`, err.message);
  };
}

const buildWorker = new Worker('build-queue', processBuildJob, { connection });
const researchWorker = new Worker('research-queue', processResearchJob, { connection });
const shipyardWorker = new Worker('shipyard-queue', processShipyardJob, { connection });
const fleetWorker = new Worker('fleet-queue', processFleetJob, { connection });

for (const [name, worker] of [
  ['build-queue', buildWorker],
  ['research-queue', researchWorker],
  ['shipyard-queue', shipyardWorker],
  ['fleet-queue', fleetWorker],
] as const) {
  worker.on('completed', logCompletion(name));
  worker.on('failed', logFailure(name));
}

// eslint-disable-next-line no-console
console.log('Eon Rover worker started, listening for build/research/shipyard/fleet events.');

const healthServer = http.createServer(createHealthHandler({
  database: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis: async () => {
    await connection.ping();
  },
}));
healthServer.listen(config.healthPort);

async function shutdown() {
  healthServer.close();
  await Promise.all([buildWorker.close(), researchWorker.close(), shipyardWorker.close(), fleetWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

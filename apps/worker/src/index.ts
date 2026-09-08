import http from 'http';
import { getWorkerConfig } from './config';

const config = getWorkerConfig();
const { Queue, Worker } = require('bullmq') as typeof import('bullmq');
const { createRedisConnection } = require('./redis') as typeof import('./redis');
const { prisma } = require('./prisma') as typeof import('./prisma');
const { createHealthHandler } = require('./health') as typeof import('./health');
const { processBuildJob } = require('./processors/buildProcessor') as typeof import('./processors/buildProcessor');
const { processResearchJob } = require('./processors/researchProcessor') as typeof import('./processors/researchProcessor');
const { processShipyardJob } = require('./processors/shipyardProcessor') as typeof import('./processors/shipyardProcessor');
const { processDeployArrivalJob } = require('./processors/deployArrivalProcessor') as typeof import('./processors/deployArrivalProcessor');
const { deployArrivalQueue } = require('./queues') as typeof import('./queues');
const {
  reconcilePendingBuildingJobs,
  startBuildingReconciliation,
} = require('./buildingReconciler') as typeof import('./buildingReconciler');
const {
  reconcilePendingResearchJobs,
  startResearchReconciliation,
} = require('./researchReconciler') as typeof import('./researchReconciler');
const {
  reconcilePendingShipyardJobs,
  startShipyardReconciliation,
} = require('./shipyardReconciler') as typeof import('./shipyardReconciler');
const {
  reconcilePendingDeployArrivalJobs,
  startDeployArrivalReconciliation,
} = require('./deployArrivalReconciler') as typeof import('./deployArrivalReconciler');
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
const buildReconciliationQueue = new Queue('build-queue', { connection });
const researchWorker = new Worker('research-queue', processResearchJob, { connection });
const researchReconciliationQueue = new Queue('research-queue', { connection });
const shipyardWorker = new Worker('shipyard-queue', processShipyardJob, { connection });
const shipyardReconciliationQueue = new Queue('shipyard-queue', { connection });
// This worker is deliberately a wake-up consumer only. It has no startup or
// recurring reconciliation; recovery of a lost Redis job is a later stage.
const deployArrivalWorker = new Worker('deploy-arrival-queue', processDeployArrivalJob, { connection });

for (const [name, worker] of [
  ['build-queue', buildWorker],
  ['research-queue', researchWorker],
  ['shipyard-queue', shipyardWorker],
  ['deploy-arrival-queue', deployArrivalWorker],
] as const) {
  worker.on('completed', logCompletion(name));
  worker.on('failed', logFailure(name));
}

// eslint-disable-next-line no-console
console.log('Eon Rover worker started, listening for build/research/shipyard/deploy-arrival events. Legacy fleet jobs are intentionally not consumed.');

let shuttingDown = false;
let buildingReconciliation: ReturnType<typeof startBuildingReconciliation> | undefined;
let researchReconciliation: ReturnType<typeof startResearchReconciliation> | undefined;
let shipyardReconciliation: ReturnType<typeof startShipyardReconciliation> | undefined;
let deployArrivalReconciliation: ReturnType<typeof startDeployArrivalReconciliation> | undefined;
void Promise.all([buildWorker.waitUntilReady(), buildReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    buildingReconciliation = startBuildingReconciliation(
      () => reconcilePendingBuildingJobs(prisma, buildReconciliationQueue),
      undefined,
      (error) => {
        // eslint-disable-next-line no-console
        console.error('[build-queue] reconciliation failed:', error instanceof Error ? error.message : 'unknown error');
      },
    );
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[build-queue] reconciliation startup failed:', error instanceof Error ? error.message : 'unknown error');
  });

void Promise.all([shipyardWorker.waitUntilReady(), shipyardReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    shipyardReconciliation = startShipyardReconciliation(
      () => reconcilePendingShipyardJobs(prisma, shipyardReconciliationQueue),
      undefined,
      (error) => {
        // eslint-disable-next-line no-console
        console.error('[shipyard-queue] reconciliation failed:', error instanceof Error ? error.message : 'unknown error');
      },
    );
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[shipyard-queue] reconciliation startup failed:', error instanceof Error ? error.message : 'unknown error');
  });

void Promise.all([researchWorker.waitUntilReady(), researchReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    researchReconciliation = startResearchReconciliation(
      () => reconcilePendingResearchJobs(prisma, researchReconciliationQueue),
      undefined,
      (error) => {
        // eslint-disable-next-line no-console
        console.error('[research-queue] reconciliation failed:', error instanceof Error ? error.message : 'unknown error');
      },
    );
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[research-queue] reconciliation startup failed:', error instanceof Error ? error.message : 'unknown error');
  });

void Promise.all([deployArrivalWorker.waitUntilReady(), deployArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    deployArrivalReconciliation = startDeployArrivalReconciliation(
      () => reconcilePendingDeployArrivalJobs(prisma, deployArrivalQueue),
      undefined,
      (error) => {
        // eslint-disable-next-line no-console
        console.error('[deploy-arrival-queue] reconciliation failed:', error instanceof Error ? error.message : 'unknown error');
      },
    );
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[deploy-arrival-queue] reconciliation startup failed:', error instanceof Error ? error.message : 'unknown error');
  });

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
  shuttingDown = true;
  buildingReconciliation?.stop();
  researchReconciliation?.stop();
  shipyardReconciliation?.stop();
  deployArrivalReconciliation?.stop();
  healthServer.close();
  await Promise.all([
    buildReconciliationQueue.close(),
    researchReconciliationQueue.close(),
    shipyardReconciliationQueue.close(),
    deployArrivalQueue.close(),
    buildWorker.close(),
    researchWorker.close(),
    shipyardWorker.close(),
    deployArrivalWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

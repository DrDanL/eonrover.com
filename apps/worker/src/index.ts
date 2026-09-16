import http from 'http';
import { getWorkerConfig } from './config';
import { emitOperationalEvent, reconciliationCounts } from './operationalEvents';

let config: ReturnType<typeof getWorkerConfig>;
try {
  config = getWorkerConfig();
} catch (error) {
  emitOperationalEvent({ event: 'worker.configuration_invalid' });
  throw error;
}
const { Queue, Worker } = require('bullmq') as typeof import('bullmq');
const { createRedisConnection } = require('./redis') as typeof import('./redis');
const { prisma } = require('./prisma') as typeof import('./prisma');
const { createHealthHandler } = require('./health') as typeof import('./health');
const { processBuildJob } = require('./processors/buildProcessor') as typeof import('./processors/buildProcessor');
const { processResearchJob } = require('./processors/researchProcessor') as typeof import('./processors/researchProcessor');
const { processShipyardJob } = require('./processors/shipyardProcessor') as typeof import('./processors/shipyardProcessor');
const { processDeployArrivalJob } = require('./processors/deployArrivalProcessor') as typeof import('./processors/deployArrivalProcessor');
const { processColonizationArrivalJob } = require('./processors/colonizationArrivalProcessor') as typeof import('./processors/colonizationArrivalProcessor');
const { processTransportArrivalJob } = require('./processors/transportArrivalProcessor') as typeof import('./processors/transportArrivalProcessor');
const { processEspionageProbeArrivalJob } = require('./processors/espionageProbeArrivalProcessor') as typeof import('./processors/espionageProbeArrivalProcessor');
const { processCorvetteStrikeArrivalJob } = require('./processors/corvetteStrikeArrivalProcessor') as typeof import('./processors/corvetteStrikeArrivalProcessor');
const { processFrigateStrikeArrivalJob } = require('./processors/frigateStrikeArrivalProcessor') as typeof import('./processors/frigateStrikeArrivalProcessor');
const { deployArrivalQueue, colonizationArrivalQueue, transportArrivalQueue, espionageProbeArrivalQueue, corvetteStrikeArrivalQueue, frigateStrikeArrivalQueue } = require('./queues') as typeof import('./queues');
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
const {
  reconcilePendingColonizationArrivalJobs,
  startColonizationArrivalReconciliation,
} = require('./colonizationArrivalReconciler') as typeof import('./colonizationArrivalReconciler');
const {
  reconcilePendingTransportArrivalJobs,
  startTransportArrivalReconciliation,
} = require('./transportArrivalReconciler') as typeof import('./transportArrivalReconciler');
const {
  reconcilePendingEspionageProbeArrivalJobs,
  startEspionageProbeArrivalReconciliation,
} = require('./espionageProbeArrivalReconciler') as typeof import('./espionageProbeArrivalReconciler');
const {
  reconcilePendingCorvetteStrikeArrivalJobs,
  startCorvetteStrikeArrivalReconciliation,
} = require('./corvetteStrikeArrivalReconciler') as typeof import('./corvetteStrikeArrivalReconciler');
const {
  reconcilePendingFrigateStrikeArrivalJobs,
  startFrigateStrikeArrivalReconciliation,
} = require('./frigateStrikeArrivalReconciler') as typeof import('./frigateStrikeArrivalReconciler');
const connection = createRedisConnection();

function logCompletion(queue: string) {
  return () => emitOperationalEvent({ event: 'worker.job_completed', queue });
}

function logFailure(queue: string) {
  return () => emitOperationalEvent({ event: 'worker.job_failed', queue });
}

function observeReconciliation(name: string, reconcile: () => Promise<unknown>): () => Promise<unknown> {
  return async () => {
    emitOperationalEvent({ event: 'worker.reconciliation_started', reconciliation: name });
    try {
      const result = await reconcile();
      emitOperationalEvent({ event: 'worker.reconciliation_completed', reconciliation: name, counts: reconciliationCounts(result) });
      return result;
    } catch (error) {
      emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: name });
      throw error;
    }
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
// Colonisation has no reconciler yet. This is only a deterministic wake-up
// consumer for the canonical completion transaction.
const colonizationArrivalWorker = new Worker('colonization-arrival-queue', processColonizationArrivalJob, { connection });
// This is a wake-up consumer only. Lost-job recovery is intentionally deferred
// to the following transport reconciliation stage.
const transportArrivalWorker = new Worker('transport-arrival-queue', processTransportArrivalJob, { connection });
// Probe work uses its own deterministic queue. Missing-job recovery remains a
// later stage; this worker only wakes the shared authoritative lifecycle.
const espionageProbeArrivalWorker = new Worker('espionage-probe-arrival-queue', processEspionageProbeArrivalJob, { connection });
const corvetteStrikeArrivalWorker = new Worker('corvette-strike-arrival-queue', processCorvetteStrikeArrivalJob, { connection });
// A separate Frigate-only queue preserves all historical Corvette and legacy Fleet lifecycles.
const frigateStrikeArrivalWorker = new Worker('frigate-strike-arrival-queue', processFrigateStrikeArrivalJob, { connection });

for (const [name, worker] of [
  ['build-queue', buildWorker],
  ['research-queue', researchWorker],
  ['shipyard-queue', shipyardWorker],
  ['deploy-arrival-queue', deployArrivalWorker],
  ['colonization-arrival-queue', colonizationArrivalWorker],
  ['transport-arrival-queue', transportArrivalWorker],
  ['espionage-probe-arrival-queue', espionageProbeArrivalWorker],
  ['corvette-strike-arrival-queue', corvetteStrikeArrivalWorker],
  ['frigate-strike-arrival-queue', frigateStrikeArrivalWorker],
] as const) {
  worker.on('completed', logCompletion(name));
  worker.on('failed', logFailure(name));
  worker.on('ready', () => emitOperationalEvent({ event: 'worker.queue_registered', queue: name }));
}

emitOperationalEvent({ event: 'worker.started' });

let shuttingDown = false;
let buildingReconciliation: ReturnType<typeof startBuildingReconciliation> | undefined;
let researchReconciliation: ReturnType<typeof startResearchReconciliation> | undefined;
let shipyardReconciliation: ReturnType<typeof startShipyardReconciliation> | undefined;
let deployArrivalReconciliation: ReturnType<typeof startDeployArrivalReconciliation> | undefined;
let colonizationArrivalReconciliation: ReturnType<typeof startColonizationArrivalReconciliation> | undefined;
let transportArrivalReconciliation: ReturnType<typeof startTransportArrivalReconciliation> | undefined;
let espionageProbeArrivalReconciliation: ReturnType<typeof startEspionageProbeArrivalReconciliation> | undefined;
let corvetteStrikeArrivalReconciliation: ReturnType<typeof startCorvetteStrikeArrivalReconciliation> | undefined;
let frigateStrikeArrivalReconciliation: ReturnType<typeof startFrigateStrikeArrivalReconciliation> | undefined;
void Promise.all([buildWorker.waitUntilReady(), buildReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    buildingReconciliation = startBuildingReconciliation(
      observeReconciliation('build', () => reconcilePendingBuildingJobs(prisma, buildReconciliationQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'build' }));

void Promise.all([shipyardWorker.waitUntilReady(), shipyardReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    shipyardReconciliation = startShipyardReconciliation(
      observeReconciliation('shipyard', () => reconcilePendingShipyardJobs(prisma, shipyardReconciliationQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'shipyard' }));

void Promise.all([researchWorker.waitUntilReady(), researchReconciliationQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    researchReconciliation = startResearchReconciliation(
      observeReconciliation('research', () => reconcilePendingResearchJobs(prisma, researchReconciliationQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'research' }));

void Promise.all([deployArrivalWorker.waitUntilReady(), deployArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    deployArrivalReconciliation = startDeployArrivalReconciliation(
      observeReconciliation('deploy-arrival', () => reconcilePendingDeployArrivalJobs(prisma, deployArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'deploy-arrival' }));

void Promise.all([colonizationArrivalWorker.waitUntilReady(), colonizationArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    colonizationArrivalReconciliation = startColonizationArrivalReconciliation(
      observeReconciliation('colonization-arrival', () => reconcilePendingColonizationArrivalJobs(prisma, colonizationArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'colonization-arrival' }));

void Promise.all([transportArrivalWorker.waitUntilReady(), transportArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    transportArrivalReconciliation = startTransportArrivalReconciliation(
      observeReconciliation('transport-arrival', () => reconcilePendingTransportArrivalJobs(prisma, transportArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'transport-arrival' }));

void Promise.all([espionageProbeArrivalWorker.waitUntilReady(), espionageProbeArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    espionageProbeArrivalReconciliation = startEspionageProbeArrivalReconciliation(
      observeReconciliation('espionage-probe-arrival', () => reconcilePendingEspionageProbeArrivalJobs(prisma, espionageProbeArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'espionage-probe-arrival' }));

void Promise.all([corvetteStrikeArrivalWorker.waitUntilReady(), corvetteStrikeArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    corvetteStrikeArrivalReconciliation = startCorvetteStrikeArrivalReconciliation(
      observeReconciliation('corvette-strike-arrival', () => reconcilePendingCorvetteStrikeArrivalJobs(prisma, corvetteStrikeArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'corvette-strike-arrival' }));

void Promise.all([frigateStrikeArrivalWorker.waitUntilReady(), frigateStrikeArrivalQueue.waitUntilReady()])
  .then(() => {
    if (shuttingDown) return;
    frigateStrikeArrivalReconciliation = startFrigateStrikeArrivalReconciliation(
      observeReconciliation('frigate-strike-arrival', () => reconcilePendingFrigateStrikeArrivalJobs(prisma, frigateStrikeArrivalQueue)),
      undefined,
      () => undefined,
    );
  })
  .catch(() => emitOperationalEvent({ event: 'worker.reconciliation_failed', reconciliation: 'frigate-strike-arrival' }));

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
  colonizationArrivalReconciliation?.stop();
  transportArrivalReconciliation?.stop();
  espionageProbeArrivalReconciliation?.stop();
  corvetteStrikeArrivalReconciliation?.stop();
  frigateStrikeArrivalReconciliation?.stop();
  healthServer.close();
  await Promise.all([
    buildReconciliationQueue.close(),
    researchReconciliationQueue.close(),
    shipyardReconciliationQueue.close(),
    deployArrivalQueue.close(),
    colonizationArrivalQueue.close(),
    transportArrivalQueue.close(),
    espionageProbeArrivalQueue.close(),
    corvetteStrikeArrivalQueue.close(),
    frigateStrikeArrivalQueue.close(),
    buildWorker.close(),
    researchWorker.close(),
    shipyardWorker.close(),
    deployArrivalWorker.close(),
    colonizationArrivalWorker.close(),
    transportArrivalWorker.close(),
    espionageProbeArrivalWorker.close(),
    corvetteStrikeArrivalWorker.close(),
    frigateStrikeArrivalWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

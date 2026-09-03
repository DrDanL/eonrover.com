import http from 'http';
import { Worker } from 'bullmq';
import { createRedisConnection } from './redis';
import { processBuildJob } from './processors/buildProcessor';
import { processResearchJob } from './processors/researchProcessor';
import { processShipyardJob } from './processors/shipyardProcessor';
import { processFleetJob } from './processors/fleetProcessor';

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

// Minimal HTTP endpoint so Docker (and other orchestrators) can healthcheck the worker process.
const healthPort = Number(process.env.WORKER_HEALTH_PORT || 4100);
const healthServer = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});
healthServer.listen(healthPort);

async function shutdown() {
  healthServer.close();
  await Promise.all([buildWorker.close(), researchWorker.close(), shipyardWorker.close(), fleetWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

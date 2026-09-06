#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  LOOPBACK_ADDRESS,
  PORT_DEFINITIONS,
  ROOT,
  assertProjectOwnership,
  buildComposeArgs,
  buildLocalEnvironment,
  buildUrls,
  redactSensitive,
  releaseReservations,
  selectPorts,
} = require('./local-startup.cjs');

const ACTION = process.argv[2] || 'start';
const DAEMON_TIMEOUT_MS = 90_000;
const SERVICE_TIMEOUT_MS = 240_000;
const LOCAL_SERVICES = ['postgres', 'redis', 'mailpit', 'api', 'worker', 'web'];
const APP_SERVICES = ['api', 'worker', 'web'];

let selectedEnvironment;
let selectedPorts;
let reservations = [];
let runtimeChanged = false;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
  });
}

function commandFailure(command, result) {
  const detail = redactSensitive(`${result.stdout || ''}\n${result.stderr || ''}`.trim());
  return new Error(`${command} failed${result.status === null ? '' : ` with status ${result.status}`}.${detail ? `\n${detail}` : ''}`);
}

function run(command, args, options = {}) {
  const result = commandResult(command, args, options);
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.signal && options.allowedSignals && options.allowedSignals.includes(result.signal)) return '';
    throw commandFailure(command, result);
  }
  return result.stdout || '';
}

function compose(actionArgs, options = {}) {
  return run('docker', buildComposeArgs(actionArgs), options);
}

function dockerCommandExists() {
  const result = commandResult('docker', ['--version'], { timeout: 5_000 });
  if (result.error && result.error.code === 'ENOENT') return false;
  return result.status === 0;
}

function dockerDaemonReady() {
  const result = commandResult('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5_000 });
  return result.status === 0 && Boolean((result.stdout || '').trim());
}

function dockerDesktopInstalled() {
  if (process.platform !== 'darwin') return false;
  const candidates = [
    '/Applications/Docker.app',
    path.join(process.env.HOME || '', 'Applications', 'Docker.app'),
  ];
  return candidates.some((candidate) => candidate && fs.existsSync(candidate));
}

async function ensureDockerDaemon() {
  if (!dockerCommandExists()) {
    throw new Error('Docker is not installed or the docker command is not on PATH.');
  }
  if (dockerDaemonReady()) return;

  if (!dockerDesktopInstalled()) {
    throw new Error('The Docker daemon is not running. Start Docker, then retry npm run start:local.');
  }

  process.stdout.write('Docker Desktop is installed but not running; starting it now...\n');
  run('open', ['-a', 'Docker']);
  const deadline = Date.now() + DAEMON_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (dockerDaemonReady()) return;
    await sleep(2_000);
  }
  throw new Error(`Docker did not become ready within ${DAEMON_TIMEOUT_MS / 1000} seconds.`);
}

function projectContainers() {
  const output = run('docker', [
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${COMPOSE_PROJECT}`,
    '--format',
    '{{.ID}}',
  ]).trim();
  if (!output) return [];
  return JSON.parse(run('docker', ['inspect', ...output.split(/\r?\n/).filter(Boolean)]));
}

function ownedPublishedPorts(containers) {
  const ports = new Set();
  for (const container of containers) {
    if (!container.State || !container.State.Running) continue;
    const bindings = (container.HostConfig && container.HostConfig.PortBindings) || {};
    for (const entries of Object.values(bindings)) {
      for (const entry of entries || []) {
        const port = Number(entry.HostPort);
        if (Number.isInteger(port)) ports.add(port);
      }
    }
  }
  return ports;
}

function reserveLoopbackPort(port, ownedPorts) {
  if (ownedPorts.has(port)) {
    return Promise.resolve({ port, owned: true, release: async () => undefined });
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const finish = (value) => {
      server.removeAllListeners('error');
      resolve(value);
    };
    server.once('error', (error) => {
      if (error && ['EADDRINUSE', 'EACCES'].includes(error.code)) {
        finish(null);
        return;
      }
      reject(error);
    });
    server.listen({ host: LOOPBACK_ADDRESS, port, exclusive: true }, () => {
      finish({
        port,
        owned: false,
        release: () => new Promise((release) => server.close(release)),
      });
    });
  });
}

function resolvedPort(config, serviceName, targetPort) {
  const service = config.services && config.services[serviceName];
  const mapping = service && Array.isArray(service.ports)
    ? service.ports.find((port) => Number(port.target) === targetPort)
    : undefined;
  const port = mapping && Number(mapping.published);
  return Number.isInteger(port) ? port : undefined;
}

function definitionsFromConfig(config) {
  const configured = {
    postgres: resolvedPort(config, 'postgres', 5432),
    redis: resolvedPort(config, 'redis', 6379),
    mailpitSmtp: resolvedPort(config, 'mailpit', 1025),
    mailpitHttp: resolvedPort(config, 'mailpit', 8025),
    api: resolvedPort(config, 'api', 4000),
    worker: resolvedPort(config, 'worker', 4100),
    web: resolvedPort(config, 'web', 3000),
  };
  return PORT_DEFINITIONS.map((definition) => ({
    ...definition,
    defaultPort: configured[definition.key] || definition.defaultPort,
  }));
}

function readComposeConfig(environment = process.env) {
  const output = compose(['config', '--format', 'json'], { env: environment });
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('Docker Compose did not return valid configuration JSON.');
  }
}

function urlEndpoint(value, fallbackPort) {
  const parsed = new URL(value);
  return `${parsed.hostname}:${parsed.port || fallbackPort}`;
}

function assertResolvedTopology(config, ports) {
  for (const serviceName of LOCAL_SERVICES) {
    if (!config.services || !config.services[serviceName]) {
      throw new Error(`Compose configuration is missing the ${serviceName} service.`);
    }
  }
  for (const serviceName of ['api', 'worker']) {
    const environment = config.services[serviceName].environment || {};
    if (urlEndpoint(environment.DATABASE_URL, '5432') !== 'postgres:5432') {
      throw new Error(`${serviceName} must use PostgreSQL at postgres:5432 inside Docker.`);
    }
    if (urlEndpoint(environment.REDIS_URL, '6379') !== 'redis:6379') {
      throw new Error(`${serviceName} must use Redis at redis:6379 inside Docker.`);
    }
  }
  const requiredDependencies = {
    api: ['postgres', 'redis', 'mailpit'],
    worker: ['postgres', 'redis', 'api'],
    web: ['api'],
  };
  for (const [serviceName, dependencies] of Object.entries(requiredDependencies)) {
    for (const dependency of dependencies) {
      const condition = config.services[serviceName].depends_on
        && config.services[serviceName].depends_on[dependency]
        && config.services[serviceName].depends_on[dependency].condition;
      if (condition !== 'service_healthy') {
        throw new Error(`${serviceName} must wait for healthy ${dependency}.`);
      }
    }
  }
  const expectedBindings = [
    ['postgres', 5432, ports.postgres],
    ['redis', 6379, ports.redis],
    ['mailpit', 1025, ports.mailpitSmtp],
    ['mailpit', 8025, ports.mailpitHttp],
    ['api', 4000, ports.api],
    ['worker', 4100, ports.worker],
    ['web', 3000, ports.web],
  ];
  for (const [serviceName, targetPort, hostPort] of expectedBindings) {
    const mapping = config.services[serviceName].ports.find(
      (port) => Number(port.target) === targetPort && Number(port.published) === hostPort,
    );
    if (!mapping || mapping.host_ip !== LOOPBACK_ADDRESS) {
      throw new Error(`${serviceName} must bind ${hostPort} on ${LOOPBACK_ADDRESS}.`);
    }
  }
}

async function releaseFor(keys) {
  const matching = reservations.filter((reservation) => keys.includes(reservation.key));
  reservations = reservations.filter((reservation) => !keys.includes(reservation.key));
  await releaseReservations(matching);
}

function assertHealthyContainers(containers) {
  const byService = new Map(
    containers.map((container) => [
      container.Config.Labels && container.Config.Labels['com.docker.compose.service'],
      container,
    ]),
  );
  for (const serviceName of LOCAL_SERVICES) {
    const container = byService.get(serviceName);
    if (!container || !container.State.Running || container.State.Health?.Status !== 'healthy') {
      throw new Error(`${serviceName} did not reach a healthy running state.`);
    }
  }

  const postgres = byService.get('postgres');
  const api = byService.get('api');
  const postgresNetworks = Object.keys(postgres.NetworkSettings.Networks || {});
  const apiNetworks = Object.keys(api.NetworkSettings.Networks || {});
  const sharedNetwork = postgresNetworks.find((network) => apiNetworks.includes(network));
  if (!sharedNetwork) throw new Error('API and PostgreSQL do not share a Docker network.');
  const aliases = postgres.NetworkSettings.Networks[sharedNetwork].Aliases || [];
  if (!aliases.includes('postgres')) throw new Error('PostgreSQL is missing its postgres network alias.');

  const databaseUrl = (api.Config.Env || []).find((entry) => entry.startsWith('DATABASE_URL='));
  if (!databaseUrl || urlEndpoint(databaseUrl.slice('DATABASE_URL='.length), '5432') !== 'postgres:5432') {
    throw new Error('The running API is not configured for postgres:5432.');
  }
}

async function waitForHttp(url, label, timeoutMs = SERVICE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: 'manual' });
      lastStatus = String(response.status);
      if (response.status >= 200 && response.status < 400) return;
    } catch {
      lastStatus = 'unreachable';
    }
    await sleep(1_000);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000} seconds (${lastStatus}).`);
}

async function printDiagnostics() {
  if (!dockerDaemonReady()) return;
  process.stderr.write('\nEon Rover diagnostics:\n');
  let failingServices = LOCAL_SERVICES;
  try {
    const containers = projectContainers();
    const byService = new Map(
      containers.map((container) => [
        container.Config.Labels && container.Config.Labels['com.docker.compose.service'],
        container,
      ]),
    );
    failingServices = LOCAL_SERVICES.filter((serviceName) => {
      const container = byService.get(serviceName);
      return !container || !container.State.Running || container.State.Health?.Status !== 'healthy';
    });
    if (failingServices.length === 0) failingServices = LOCAL_SERVICES;
    const status = compose(['ps', '--all']);
    process.stderr.write(`${redactSensitive(status)}\n`);
  } catch (error) {
    process.stderr.write(`${redactSensitive(error.message)}\n`);
  }
  try {
    const logs = compose(['logs', '--no-color', '--tail', '80', ...failingServices]);
    process.stderr.write(`${redactSensitive(logs)}\n`);
  } catch (error) {
    process.stderr.write(`${redactSensitive(error.message)}\n`);
  }
}

function printPortSelections(definitions, ports) {
  const replacements = definitions.filter((definition) => ports[definition.key] !== definition.defaultPort);
  if (replacements.length === 0) {
    process.stdout.write('All configured host ports are available.\n');
    return;
  }
  process.stdout.write('Occupied host ports were replaced without touching their owners:\n');
  for (const definition of replacements) {
    process.stdout.write(`  ${definition.label}: ${definition.defaultPort} -> ${ports[definition.key]}\n`);
  }
}

async function startLocal() {
  process.stdout.write('Inspecting the existing Eon Rover Compose configuration...\n');
  const existingContainers = projectContainers();
  assertProjectOwnership(existingContainers);
  const existingConfig = readComposeConfig();
  const definitions = definitionsFromConfig(existingConfig);
  const ownedPorts = ownedPublishedPorts(existingContainers);
  const selection = await selectPorts(
    definitions,
    (port) => reserveLoopbackPort(port, ownedPorts),
  );
  selectedPorts = selection.ports;
  reservations = selection.reservations;
  selectedEnvironment = buildLocalEnvironment(process.env, selectedPorts);

  const resolvedConfig = readComposeConfig(selectedEnvironment);
  assertResolvedTopology(resolvedConfig, selectedPorts);
  printPortSelections(definitions, selectedPorts);

  process.stdout.write('Building the API, worker, and web images...\n');
  compose(['build', ...APP_SERVICES], { env: selectedEnvironment, inherit: true });

  process.stdout.write('Stopping only the Eon Rover application tier for a clean repair...\n');
  compose(['stop', ...APP_SERVICES], { env: selectedEnvironment, inherit: true });
  runtimeChanged = true;

  process.stdout.write('Starting PostgreSQL, Redis, and Mailpit and waiting for readiness...\n');
  await releaseFor(['postgres', 'redis', 'mailpitSmtp', 'mailpitHttp']);
  compose(
    ['up', '--detach', '--wait', '--wait-timeout', '180', 'postgres', 'redis', 'mailpit'],
    { env: selectedEnvironment, inherit: true },
  );

  process.stdout.write('Starting a freshly reconciled API after its dependencies are healthy...\n');
  await releaseFor(['api']);
  compose(
    ['up', '--detach', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '240', 'api'],
    { env: selectedEnvironment, inherit: true },
  );

  process.stdout.write('Starting the worker and web application...\n');
  await releaseFor(['worker']);
  compose(
    ['up', '--detach', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '180', 'worker'],
    { env: selectedEnvironment, inherit: true },
  );
  await releaseFor(['web']);
  compose(
    ['up', '--detach', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '180', 'web'],
    { env: selectedEnvironment, inherit: true },
  );

  const runningContainers = projectContainers();
  assertProjectOwnership(runningContainers);
  assertHealthyContainers(runningContainers);

  const urls = buildUrls(selectedPorts);
  await Promise.all([
    waitForHttp(urls.find((entry) => entry.label === 'API liveness').url, 'API liveness'),
    waitForHttp(urls.find((entry) => entry.label === 'API readiness').url, 'API readiness'),
    waitForHttp(urls.find((entry) => entry.label === 'Worker liveness').url, 'Worker liveness'),
    waitForHttp(urls.find((entry) => entry.label === 'Worker readiness').url, 'Worker readiness'),
    waitForHttp(urls.find((entry) => entry.label === 'Public home').url, 'Web application'),
    waitForHttp(urls.find((entry) => entry.label === 'Mailpit').url, 'Mailpit'),
  ]);

  process.stdout.write('\nEon Rover is ready:\n');
  for (const entry of urls) process.stdout.write(`  ${entry.label}: ${entry.url}\n`);
}

async function stopLocal() {
  const containers = projectContainers();
  assertProjectOwnership(containers);
  if (containers.length === 0) {
    process.stdout.write('No Eon Rover containers exist.\n');
    return;
  }
  compose(['stop'], { inherit: true });
  process.stdout.write('Eon Rover is stopped. Local database volumes were preserved.\n');
}

async function logsLocal() {
  const containers = projectContainers();
  assertProjectOwnership(containers);
  compose(['logs', '--follow', '--tail', '200', ...LOCAL_SERVICES], {
    inherit: true,
    allowedSignals: ['SIGINT', 'SIGTERM'],
  });
}

async function main() {
  if (!['start', 'stop', 'logs'].includes(ACTION)) throw new Error(`Unknown local action: ${ACTION}.`);
  if (!fs.existsSync(COMPOSE_FILE)) throw new Error(`Missing Compose file: ${COMPOSE_FILE}`);
  await ensureDockerDaemon();
  if (ACTION === 'start') await startLocal();
  if (ACTION === 'stop') await stopLocal();
  if (ACTION === 'logs') await logsLocal();
}

void main()
  .catch(async (error) => {
    await releaseReservations(reservations).catch(() => undefined);
    process.stderr.write(`\nLocal ${ACTION} failed: ${redactSensitive(error.message)}\n`);
    if (ACTION === 'start' && runtimeChanged) await printDiagnostics();
    process.exitCode = 1;
  });

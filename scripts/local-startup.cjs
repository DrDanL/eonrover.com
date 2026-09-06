'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml');
const COMPOSE_PROJECT = 'eonrovercom';
const LOOPBACK_ADDRESS = '127.0.0.1';
const FALLBACK_ATTEMPTS = 20;

const PORT_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'postgres', label: 'PostgreSQL', environment: 'POSTGRES_HOST_PORT', defaultPort: 5432, fallbackStart: 55432 }),
  Object.freeze({ key: 'redis', label: 'Redis', environment: 'REDIS_HOST_PORT', defaultPort: 6379, fallbackStart: 56379 }),
  Object.freeze({ key: 'mailpitSmtp', label: 'Mailpit SMTP', environment: 'MAILPIT_SMTP_HOST_PORT', defaultPort: 1025, fallbackStart: 51025 }),
  Object.freeze({ key: 'mailpitHttp', label: 'Mailpit web', environment: 'MAILPIT_HTTP_HOST_PORT', defaultPort: 8025, fallbackStart: 58025 }),
  Object.freeze({ key: 'api', label: 'API', environment: 'API_HOST_PORT', defaultPort: 4000, fallbackStart: 54000 }),
  Object.freeze({ key: 'worker', label: 'Worker health', environment: 'WORKER_HEALTH_HOST_PORT', defaultPort: 4100, fallbackStart: 54100 }),
  Object.freeze({ key: 'web', label: 'Web', environment: 'WEB_HOST_PORT', defaultPort: 3000, fallbackStart: 53000 }),
]);

const NAVIGABLE_PATHS = Object.freeze([
  Object.freeze({ label: 'Public home', service: 'web', path: '/' }),
  Object.freeze({ label: 'Registration', service: 'web', path: '/register' }),
  Object.freeze({ label: 'Login', service: 'web', path: '/login' }),
  Object.freeze({ label: 'Resend verification', service: 'web', path: '/resend-verification' }),
  Object.freeze({ label: 'Player application', service: 'web', path: '/game' }),
  Object.freeze({ label: 'Administrator area', service: 'web', path: '/admin' }),
  Object.freeze({ label: 'API liveness', service: 'api', path: '/healthz' }),
  Object.freeze({ label: 'API readiness', service: 'api', path: '/readyz' }),
  Object.freeze({ label: 'Mailpit', service: 'mailpitHttp', path: '/' }),
  Object.freeze({ label: 'Worker liveness', service: 'worker', path: '/healthz' }),
  Object.freeze({ label: 'Worker readiness', service: 'worker', path: '/readyz' }),
]);

function candidatesFor(definition, attempts = FALLBACK_ATTEMPTS) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('Port fallback attempts must be positive.');
  const candidates = [definition.defaultPort];
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = definition.fallbackStart + offset;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

async function releaseReservations(reservations) {
  await Promise.all(reservations.map((reservation) => reservation.release()));
}

async function selectPorts(definitions, reservePort, attempts = FALLBACK_ATTEMPTS) {
  const ports = {};
  const reservations = [];
  const selected = new Set();

  try {
    for (const definition of definitions) {
      let reservation;
      for (const candidate of candidatesFor(definition, attempts)) {
        if (selected.has(candidate)) continue;
        reservation = await reservePort(candidate, definition);
        if (reservation) break;
      }
      if (!reservation) {
        throw new Error(
          `No available loopback host port for ${definition.label} after a bounded search.`,
        );
      }
      ports[definition.key] = reservation.port;
      selected.add(reservation.port);
      reservations.push({ ...reservation, key: definition.key });
    }
  } catch (error) {
    await releaseReservations(reservations);
    throw error;
  }

  return { ports: Object.freeze(ports), reservations };
}

function buildLocalEnvironment(environment, ports) {
  return {
    ...environment,
    BIND_ADDRESS: LOOPBACK_ADDRESS,
    POSTGRES_HOST_PORT: String(ports.postgres),
    REDIS_HOST_PORT: String(ports.redis),
    MAILPIT_SMTP_HOST_PORT: String(ports.mailpitSmtp),
    MAILPIT_HTTP_HOST_PORT: String(ports.mailpitHttp),
    API_HOST_PORT: String(ports.api),
    WORKER_HEALTH_HOST_PORT: String(ports.worker),
    WEB_HOST_PORT: String(ports.web),
    PORT: '4000',
    WORKER_HEALTH_PORT: '4100',
    REDIS_URL: 'redis://redis:6379',
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    WEB_URL: `http://${LOOPBACK_ADDRESS}:${ports.web}`,
    NEXT_PUBLIC_API_URL: `http://${LOOPBACK_ADDRESS}:${ports.api}`,
    COOKIE_SECURE: 'false',
    NODE_ENV: 'development',
    ADMIN_EMAIL: '',
    ADMIN_USERNAME: '',
    ADMIN_PASSWORD: '',
  };
}

function buildUrls(ports) {
  const origins = {
    web: `http://${LOOPBACK_ADDRESS}:${ports.web}`,
    api: `http://${LOOPBACK_ADDRESS}:${ports.api}`,
    mailpitHttp: `http://${LOOPBACK_ADDRESS}:${ports.mailpitHttp}`,
    worker: `http://${LOOPBACK_ADDRESS}:${ports.worker}`,
  };
  return NAVIGABLE_PATHS.map((entry) => ({
    label: entry.label,
    url: new URL(entry.path, origins[entry.service]).toString(),
  }));
}

function buildComposeArgs(actionArgs, composeFile = COMPOSE_FILE) {
  if (!Array.isArray(actionArgs) || actionArgs.length === 0) {
    throw new Error('A local Compose action is required.');
  }
  const allowedActions = new Set(['build', 'config', 'logs', 'ps', 'stop', 'up']);
  if (!allowedActions.has(actionArgs[0])) {
    throw new Error(`Refusing unsafe local Compose action: ${actionArgs[0]}.`);
  }
  if (actionArgs.some((argument) => ['--volumes', '-v', 'prune', 'rm', 'kill'].includes(argument))) {
    throw new Error('Refusing a destructive local Compose argument.');
  }
  return ['compose', '--project-name', COMPOSE_PROJECT, '--file', composeFile, ...actionArgs];
}

function redactSensitive(value, explicitSecrets = []) {
  let redacted = String(value ?? '');
  for (const secret of explicitSecrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted
    .replace(/\b(postgres(?:ql)?|redis(?:s)?):\/\/[^\s"'`]+/gi, '$1://[REDACTED]')
    .replace(/(eonrover_sid=)[^;\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|code|key)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/((?:PASSWORD|TOKEN|COOKIE|AUTHORIZATION|SECRET|DATABASE_URL|REDIS_URL)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|token|cookie|authorization|secret)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function assertProjectOwnership(containers, root = ROOT) {
  for (const container of containers) {
    const labels = (container.Config && container.Config.Labels) || {};
    const project = labels['com.docker.compose.project'];
    const workingDirectory = labels['com.docker.compose.project.working_dir'];
    if (project !== COMPOSE_PROJECT) {
      throw new Error('Refusing a container outside the Eon Rover Compose project.');
    }
    if (workingDirectory && path.resolve(workingDirectory) !== path.resolve(root)) {
      throw new Error(
        `Refusing to modify Compose project ${COMPOSE_PROJECT} because it belongs to another directory.`,
      );
    }
  }
}

module.exports = {
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  FALLBACK_ATTEMPTS,
  LOOPBACK_ADDRESS,
  NAVIGABLE_PATHS,
  PORT_DEFINITIONS,
  ROOT,
  assertProjectOwnership,
  buildComposeArgs,
  buildLocalEnvironment,
  buildUrls,
  candidatesFor,
  redactSensitive,
  releaseReservations,
  selectPorts,
};

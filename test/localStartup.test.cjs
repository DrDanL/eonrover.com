'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  COMPOSE_PROJECT,
  LOOPBACK_ADDRESS,
  PORT_DEFINITIONS,
  assertProjectOwnership,
  buildComposeArgs,
  buildLocalEnvironment,
  redactSensitive,
  releaseReservations,
  selectPorts,
} = require('../scripts/local-startup.cjs');

function fakeReservationFactory(occupied = new Set()) {
  return async (port) => {
    if (occupied.has(port)) return null;
    return { port, release: async () => undefined };
  };
}

test('local port selection retains every available configured default', async () => {
  const selection = await selectPorts(PORT_DEFINITIONS, fakeReservationFactory());
  for (const definition of PORT_DEFINITIONS) {
    assert.equal(selection.ports[definition.key], definition.defaultPort);
  }
  await releaseReservations(selection.reservations);
});

test('local port selection uses the predictable fallback when a default is occupied', async () => {
  const postgres = PORT_DEFINITIONS.find((definition) => definition.key === 'postgres');
  const selection = await selectPorts([postgres], fakeReservationFactory(new Set([postgres.defaultPort])));
  assert.equal(selection.ports.postgres, postgres.fallbackStart);
});

test('local port selection skips multiple occupied fallback ports', async () => {
  const api = PORT_DEFINITIONS.find((definition) => definition.key === 'api');
  const occupied = new Set([api.defaultPort, api.fallbackStart, api.fallbackStart + 1]);
  const selection = await selectPorts([api], fakeReservationFactory(occupied));
  assert.equal(selection.ports.api, api.fallbackStart + 2);
});

test('local port selection fails after bounded exhaustion', async () => {
  const web = PORT_DEFINITIONS.find((definition) => definition.key === 'web');
  const occupied = new Set([web.defaultPort, web.fallbackStart, web.fallbackStart + 1]);
  await assert.rejects(
    selectPorts([web], fakeReservationFactory(occupied), 2),
    /bounded search/,
  );
});

test('local environment binds host ports to loopback and preserves internal service addresses', () => {
  const ports = Object.fromEntries(PORT_DEFINITIONS.map((definition) => [definition.key, definition.defaultPort]));
  const environment = buildLocalEnvironment({ UNRELATED_VALUE: 'preserved' }, ports);

  assert.equal(environment.BIND_ADDRESS, LOOPBACK_ADDRESS);
  assert.equal(environment.REDIS_URL, 'redis://redis:6379');
  assert.equal(environment.SMTP_HOST, 'mailpit');
  assert.equal(environment.SMTP_PORT, '1025');
  assert.equal(environment.PORT, '4000');
  assert.equal(environment.WORKER_HEALTH_PORT, '4100');
  assert.equal(environment.UNRELATED_VALUE, 'preserved');
  assert.equal(environment.ADMIN_PASSWORD, '');
});

test('local Docker commands are scoped to the fixed Eon Rover Compose project', () => {
  const args = buildComposeArgs(['up', '--detach'], '/repo/docker-compose.yml');
  assert.deepEqual(args, [
    'compose',
    '--project-name',
    COMPOSE_PROJECT,
    '--file',
    '/repo/docker-compose.yml',
    'up',
    '--detach',
  ]);
  assert.deepEqual(buildComposeArgs(['stop'], '/repo/docker-compose.yml').slice(-1), ['stop']);
  assert.deepEqual(buildComposeArgs(['logs', '--follow'], '/repo/docker-compose.yml').slice(-2), ['logs', '--follow']);
  assert.throws(() => buildComposeArgs(['down', '--volumes']), /unsafe local Compose action/);
  assert.throws(() => buildComposeArgs(['up', '--volumes']), /destructive local Compose argument/);
});

test('local diagnostics redact URLs, credentials, cookies, and tokens', () => {
  const secret = 'local-start-secret';
  const redacted = redactSensitive(
    `DATABASE_URL=postgresql://user:password@postgres:5432/eonrover ` +
      `REDIS_URL=redis://redis:6379 token=${secret} eonrover_sid=session-secret ` +
      '{"password":"json-secret"}',
    [secret],
  );
  for (const value of ['user:password', secret, 'session-secret', 'json-secret']) {
    assert.equal(redacted.includes(value), false);
  }
  assert.match(redacted, /\[REDACTED\]/);
});

test('local commands refuse a same-named Compose project owned by another directory', () => {
  const container = {
    Config: {
      Labels: {
        'com.docker.compose.project': COMPOSE_PROJECT,
        'com.docker.compose.project.working_dir': '/another/project',
      },
    },
  };
  assert.throws(() => assertProjectOwnership([container], '/repo'), /another directory/);
  assert.doesNotThrow(() => assertProjectOwnership([
    {
      Config: {
        Labels: {
          'com.docker.compose.project': COMPOSE_PROJECT,
          'com.docker.compose.project.working_dir': '/repo',
        },
      },
    },
  ], '/repo'));
});

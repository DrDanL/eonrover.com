#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml');
const COMPOSE_PROJECT = 'eonrovercom';
const TEST_DATABASE = 'eonrover_automation_test';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_INSTALL = process.argv.includes('--skip-install');
const ALLOWED_ARGUMENTS = new Set(['--dry-run', '--skip-install']);

let stepNumber = 0;

function step(message) {
  stepNumber += 1;
  process.stdout.write(`\n[${stepNumber}] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  if (DRY_RUN) {
    process.stdout.write(`    ${[command, ...args].join(' ')}\n`);
    return { stdout: '' };
  }

  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: options.env || process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${`${result.stdout || ''}${result.stderr || ''}`.trim()}` : '';
    fail(`${command} exited with status ${result.status}.${detail}`);
  }

  return { stdout: result.stdout || '' };
}

function compose(args, options = {}) {
  return run(
    'docker',
    ['compose', '--project-name', COMPOSE_PROJECT, '--file', COMPOSE_FILE, ...args],
    options,
  );
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`Compose did not resolve ${name}.`);
  return value;
}

function publishedPort(config, serviceName, targetPort) {
  const service = config.services && config.services[serviceName];
  const mapping = service && Array.isArray(service.ports)
    ? service.ports.find((port) => Number(port.target) === targetPort)
    : undefined;
  const published = mapping && String(mapping.published);
  if (!published || !/^\d+$/.test(published)) {
    fail(`Compose did not publish ${serviceName} port ${targetPort}.`);
  }
  return published;
}

function readComposeConfig() {
  const output = compose(['config', '--format', 'json'], { capture: true }).stdout;
  let config;
  try {
    config = JSON.parse(output);
  } catch {
    fail('Docker Compose did not return valid JSON configuration.');
  }

  const postgres = config.services && config.services.postgres;
  const environment = postgres && postgres.environment;
  if (!environment || Array.isArray(environment)) fail('Compose has no PostgreSQL environment map.');

  const postgresUser = requireString(environment.POSTGRES_USER, 'POSTGRES_USER');
  const postgresPassword = requireString(environment.POSTGRES_PASSWORD, 'POSTGRES_PASSWORD');
  const postgresDatabase = requireString(environment.POSTGRES_DB, 'POSTGRES_DB');
  if (postgresDatabase === TEST_DATABASE) {
    fail(`POSTGRES_DB must not use the isolated test database name ${TEST_DATABASE}.`);
  }

  return {
    postgresUser,
    postgresPassword,
    postgresPort: publishedPort(config, 'postgres', 5432),
    redisPort: publishedPort(config, 'redis', 6379),
    smtpPort: publishedPort(config, 'mailpit', 1025),
    webPort: publishedPort(config, 'web', 3000),
    apiPort: publishedPort(config, 'api', Number(config.services.api.environment.PORT || 4000)),
    mailpitPort: publishedPort(config, 'mailpit', 8025),
  };
}

function localTestEnvironment(config) {
  const username = encodeURIComponent(config.postgresUser);
  const password = encodeURIComponent(config.postgresPassword);
  const databaseUrl =
    `postgresql://${username}:${password}@127.0.0.1:${config.postgresPort}/${TEST_DATABASE}`;

  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    ALLOW_TEST_DATABASE_RESET: '1',
    REDIS_URL: `redis://127.0.0.1:${config.redisPort}/15`,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: config.smtpPort,
  };
}

function printDryRun() {
  step('Validate local prerequisites and Compose configuration');
  run('docker', ['info']);
  compose(['config', '--quiet']);
  if (!SKIP_INSTALL) run('npm', ['ci']);

  step(`Reset only the ${COMPOSE_PROJECT} containers, network, and volumes`);
  compose(['down', '--volumes', '--remove-orphans']);

  step('Start clean PostgreSQL, Redis, and Mailpit services');
  compose(['up', '--detach', '--wait', 'postgres', 'redis', 'mailpit']);

  step(`Generate Prisma Client, then create and migrate the isolated ${TEST_DATABASE} database`);
  process.stdout.write('    npm run prisma:generate --workspace @eonrover/api\n');
  process.stdout.write('    docker compose ... exec -T postgres createdb <resolved-user> eonrover_automation_test\n');
  process.stdout.write('    npm run prisma:migrate:deploy --workspace @eonrover/api\n');

  step('Run the complete unit and integration test suite');
  run('npm', ['test']);

  step('Build every workspace and validate the working diff');
  run('npm', ['run', 'build']);
  run('git', ['diff', '--check']);

  step('Run the disposable full-stack and restart verification');
  run('npm', ['run', 'test:vertical-slice']);

  step('Build and start the normal Eon Rover development stack');
  compose(['up', '--detach', '--build', '--wait'], {
    env: {
      ...process.env,
      ADMIN_EMAIL: '',
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '',
    },
  });
  compose(['ps']);
}

function main() {
  const unexpectedArguments = process.argv.slice(2).filter((argument) => !ALLOWED_ARGUMENTS.has(argument));
  if (unexpectedArguments.length > 0) fail(`Unknown argument: ${unexpectedArguments[0]}`);
  if (!fs.existsSync(COMPOSE_FILE)) fail(`Missing Compose file: ${COMPOSE_FILE}`);

  process.stdout.write('Eon Rover clean-start verification\n');
  process.stdout.write(
    `This removes only Docker Compose project "${COMPOSE_PROJECT}", including its local data volumes.\n`,
  );
  process.stdout.write('Other Docker projects, containers, networks, and volumes are not targeted.\n');

  if (DRY_RUN) {
    process.stdout.write('Dry run: commands will be displayed but not executed.\n');
    printDryRun();
    return;
  }

  step('Validate local prerequisites and Compose configuration');
  run('docker', ['info'], { capture: true });
  run('docker', ['compose', 'version'], { capture: true });
  compose(['config', '--quiet']);
  const config = readComposeConfig();
  if (!SKIP_INSTALL) run('npm', ['ci']);

  step(`Reset only the ${COMPOSE_PROJECT} containers, network, and volumes`);
  compose(['down', '--volumes', '--remove-orphans']);

  step('Start clean PostgreSQL, Redis, and Mailpit services');
  compose(['up', '--detach', '--wait', 'postgres', 'redis', 'mailpit']);

  step(`Generate Prisma Client, then create and migrate the isolated ${TEST_DATABASE} database`);
  run('npm', ['run', 'prisma:generate', '--workspace', '@eonrover/api']);
  compose([
    'exec',
    '-T',
    'postgres',
    'createdb',
    '--username',
    config.postgresUser,
    '--owner',
    config.postgresUser,
    TEST_DATABASE,
  ]);
  const testEnvironment = localTestEnvironment(config);
  run(
    'npm',
    ['run', 'prisma:migrate:deploy', '--workspace', '@eonrover/api'],
    { env: testEnvironment },
  );

  step('Run the complete unit and integration test suite');
  run('npm', ['test'], { env: testEnvironment });

  step('Build every workspace and validate the working diff');
  run('npm', ['run', 'build']);
  run('git', ['diff', '--check']);

  step('Run the disposable full-stack and restart verification');
  const e2eEnvironment = { ...process.env, ALLOW_DISPOSABLE_E2E: '1' };
  delete e2eEnvironment.EONROVER_E2E_PROJECT;
  delete e2eEnvironment.EONROVER_E2E_DATABASE_URL;
  run('npm', ['run', 'test:vertical-slice'], { env: e2eEnvironment });

  step('Build and start the normal Eon Rover development stack');
  compose(['up', '--detach', '--build', '--wait'], {
    env: {
      ...process.env,
      ADMIN_EMAIL: '',
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '',
    },
  });
  compose(['ps']);

  process.stdout.write('\nPASS: clean reset, automated verification, and development startup completed.\n');
  process.stdout.write(`Web: http://localhost:${config.webPort}\n`);
  process.stdout.write(`API: http://localhost:${config.apiPort}\n`);
  process.stdout.write(`Mailpit: http://localhost:${config.mailpitPort}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`\nFAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

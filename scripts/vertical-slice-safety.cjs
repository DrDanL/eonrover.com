'use strict';

const { randomBytes } = require('node:crypto');

const SAFE_PROJECT_PATTERN = /^eonrover-e2e-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_DEVELOPMENT_PROJECTS = new Set(['eonrover', 'eonrovercom']);
const DISPOSABLE_DATABASE_NAME = 'eonrover_e2e_test';
const DISPOSABLE_DATABASE_HOST = 'postgres';
const DISPOSABLE_DATABASE_USER = 'eonrover_e2e';
const DISPOSABLE_DATABASE_PASSWORD = 'disposable_e2e_only';
const DISPOSABLE_DATABASE_URL =
  `postgresql://${DISPOSABLE_DATABASE_USER}:${DISPOSABLE_DATABASE_PASSWORD}` +
  `@${DISPOSABLE_DATABASE_HOST}:5432/${DISPOSABLE_DATABASE_NAME}`;

function generateProjectName(now = Date.now, random = randomBytes) {
  return `eonrover-e2e-${now().toString(36)}-${random(4).toString('hex')}`;
}

function assertSafeProjectName(projectName) {
  if (DEFAULT_DEVELOPMENT_PROJECTS.has(projectName)) {
    throw new Error('Refusing to target the default Eon Rover development Compose project.');
  }
  if (
    typeof projectName !== 'string' ||
    projectName.length > 63 ||
    !SAFE_PROJECT_PATTERN.test(projectName)
  ) {
    throw new Error('EONROVER_E2E_PROJECT must match the safe eonrover-e2e-* project-name pattern.');
  }
  return projectName;
}

function assertDisposableDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Refusing an invalid disposable E2E database URL.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error('Refusing an invalid disposable E2E database URL.');
  }

  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hostname !== DISPOSABLE_DATABASE_HOST ||
    (parsed.port && parsed.port !== '5432') ||
    decodeURIComponent(parsed.username) !== DISPOSABLE_DATABASE_USER ||
    decodeURIComponent(parsed.password) !== DISPOSABLE_DATABASE_PASSWORD ||
    databaseName !== DISPOSABLE_DATABASE_NAME ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Refusing a database outside the fixed disposable E2E Compose service.');
  }
  return value;
}

function resolveSafetyConfig(environment, options = {}) {
  if (environment.ALLOW_DISPOSABLE_E2E !== '1') {
    throw new Error('Set ALLOW_DISPOSABLE_E2E=1 to authorize the disposable full-stack verification.');
  }

  const projectName = assertSafeProjectName(
    environment.EONROVER_E2E_PROJECT || generateProjectName(options.now, options.randomBytes),
  );
  const databaseUrl = assertDisposableDatabaseUrl(
    environment.EONROVER_E2E_DATABASE_URL || DISPOSABLE_DATABASE_URL,
  );
  return Object.freeze({ projectName, databaseUrl });
}

function redactSecrets(value, explicitSecrets = []) {
  let redacted = String(value ?? '');
  const secrets = explicitSecrets
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) redacted = redacted.split(secret).join('[REDACTED]');

  return redacted
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/(eonrover_sid=)[^;\s]+/gi, '$1[REDACTED]')
    .replace(/([?&]token=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|token|cookie|authorization)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function buildComposeArgs(projectName, composeFiles, actionArgs) {
  assertSafeProjectName(projectName);
  if (!Array.isArray(composeFiles) || composeFiles.length < 1) {
    throw new Error('At least one Compose file is required.');
  }
  return [
    'compose',
    '--project-name',
    projectName,
    ...composeFiles.flatMap((file) => ['--file', file]),
    ...actionArgs,
  ];
}

function buildCleanupCommand(projectName, composeFiles) {
  return {
    command: 'docker',
    args: buildComposeArgs(projectName, composeFiles, ['down', '--volumes', '--remove-orphans']),
  };
}

module.exports = {
  DEFAULT_DEVELOPMENT_PROJECTS,
  DISPOSABLE_DATABASE_HOST,
  DISPOSABLE_DATABASE_NAME,
  DISPOSABLE_DATABASE_PASSWORD,
  DISPOSABLE_DATABASE_URL,
  DISPOSABLE_DATABASE_USER,
  SAFE_PROJECT_PATTERN,
  assertDisposableDatabaseUrl,
  assertSafeProjectName,
  buildCleanupCommand,
  buildComposeArgs,
  generateProjectName,
  redactSecrets,
  resolveSafetyConfig,
};

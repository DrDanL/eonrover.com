'use strict';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const ADMIN_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1', 'defaultdb']);

class TestDatabaseSafetyError extends Error {
  constructor(reason) {
    super(`Refusing destructive database tests: ${reason}`);
    this.name = 'TestDatabaseSafetyError';
  }
}

function refuse(reason) {
  throw new TestDatabaseSafetyError(reason);
}

function validateTestDatabaseEnvironment(environment = process.env) {
  const testDatabaseUrl = environment.TEST_DATABASE_URL;

  if (typeof testDatabaseUrl !== 'string' || testDatabaseUrl.length === 0) {
    refuse('TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback.');
  }
  if (testDatabaseUrl !== testDatabaseUrl.trim()) {
    refuse('TEST_DATABASE_URL must be a well-formed PostgreSQL URL without surrounding whitespace.');
  }
  if (environment.ALLOW_TEST_DATABASE_RESET !== '1') {
    refuse('ALLOW_TEST_DATABASE_RESET must equal exactly 1.');
  }

  let parsed;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    refuse('TEST_DATABASE_URL must be a well-formed PostgreSQL URL.');
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    refuse('TEST_DATABASE_URL must use the postgres: or postgresql: protocol.');
  }

  const encodedName = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : '';
  if (!encodedName) {
    refuse('TEST_DATABASE_URL must contain a database name in its pathname.');
  }
  if (encodedName.includes('/')) {
    refuse('TEST_DATABASE_URL must contain exactly one unambiguous database-name path segment.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(encodedName);
  } catch {
    refuse('TEST_DATABASE_URL contains an invalid encoded database name.');
  }

  if (
    !databaseName ||
    databaseName !== databaseName.trim() ||
    databaseName.includes('/') ||
    databaseName.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(databaseName)
  ) {
    refuse('TEST_DATABASE_URL must contain one non-empty, unambiguous database name.');
  }

  if (ADMIN_DATABASE_NAMES.has(databaseName.toLowerCase())) {
    refuse('administrative PostgreSQL database names are never allowed.');
  }
  if (!databaseName.endsWith('_test')) {
    refuse('the decoded PostgreSQL database name must end with _test.');
  }

  return Object.freeze({ url: testDatabaseUrl, databaseName });
}

function configureTestDatabaseEnvironment(environment = process.env) {
  const validated = validateTestDatabaseEnvironment(environment);
  environment.DATABASE_URL = validated.url;
  return validated;
}

function runDestructiveTestDatabaseOperation(environment, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('A destructive test database operation callback is required.');
  }
  configureTestDatabaseEnvironment(environment);
  return operation();
}

module.exports = {
  TestDatabaseSafetyError,
  configureTestDatabaseEnvironment,
  runDestructiveTestDatabaseOperation,
  validateTestDatabaseEnvironment,
};

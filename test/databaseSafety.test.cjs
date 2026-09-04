'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  TestDatabaseSafetyError,
  configureTestDatabaseEnvironment,
  runDestructiveTestDatabaseOperation,
  validateTestDatabaseEnvironment,
} = require('./databaseSafety.cjs');

const VALID_URL = 'postgresql://test_user:test_password@127.0.0.1:5432/eonrover_test';

function environment(overrides = {}) {
  return {
    TEST_DATABASE_URL: VALID_URL,
    ALLOW_TEST_DATABASE_RESET: '1',
    ...overrides,
  };
}

function expectRefusal(overrides, messagePattern) {
  assert.throws(
    () => validateTestDatabaseEnvironment(environment(overrides)),
    (error) => error instanceof TestDatabaseSafetyError && messagePattern.test(error.message),
  );
}

describe('test database safety guard', () => {
  test('rejects missing TEST_DATABASE_URL even when DATABASE_URL is present', () => {
    expectRefusal(
      { TEST_DATABASE_URL: undefined, DATABASE_URL: 'postgresql://localhost/eonrover' },
      /TEST_DATABASE_URL is required/,
    );
  });

  test('rejects missing reset opt-in', () => {
    expectRefusal({ ALLOW_TEST_DATABASE_RESET: undefined }, /must equal exactly 1/);
  });

  test('rejects reset opt-in values other than exactly 1', () => {
    for (const value of ['true', 'yes', '01', '1 ']) {
      expectRefusal({ ALLOW_TEST_DATABASE_RESET: value }, /must equal exactly 1/);
    }
  });

  test('rejects malformed URLs', () => {
    expectRefusal({ TEST_DATABASE_URL: 'not a database url' }, /well-formed PostgreSQL URL/);
  });

  test('rejects non-PostgreSQL URLs', () => {
    expectRefusal({ TEST_DATABASE_URL: 'mysql://localhost/eonrover_test' }, /postgres: or postgresql:/);
  });

  test('rejects a missing database name', () => {
    expectRefusal({ TEST_DATABASE_URL: 'postgresql://localhost/' }, /contain a database name/);
  });

  test('rejects a normal development database name', () => {
    expectRefusal({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover' }, /must end with _test/);
  });

  test('rejects common administrative database names', async (t) => {
    for (const databaseName of ['postgres', 'template0', 'template1', 'defaultdb']) {
      await t.test(databaseName, () => {
        expectRefusal(
          { TEST_DATABASE_URL: `postgresql://localhost/${databaseName}` },
          /administrative PostgreSQL database names/,
        );
      });
    }
  });

  test('rejects a name containing test that does not end with _test', () => {
    expectRefusal({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover_test_copy' }, /must end with _test/);
  });

  test('rejects ambiguous plain or encoded database-name paths', () => {
    expectRefusal({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover_test/archive' }, /unambiguous/);
    expectRefusal({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover%2Farchive_test' }, /unambiguous/);
  });

  test('accepts postgres and postgresql URLs whose decoded name ends with _test', () => {
    const postgres = validateTestDatabaseEnvironment(
      environment({ TEST_DATABASE_URL: 'postgres://localhost/eonrover_test' }),
    );
    const postgresql = validateTestDatabaseEnvironment(
      environment({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover%5Ftest' }),
    );

    assert.equal(postgres.databaseName, 'eonrover_test');
    assert.equal(postgresql.databaseName, 'eonrover_test');
  });

  test('does not expose passwords or complete URLs in refusal errors', () => {
    const secretUrl = 'postgresql://sensitive_user:do-not-leak@db.internal:5432/eonrover';
    let refusal;

    try {
      validateTestDatabaseEnvironment(environment({ TEST_DATABASE_URL: secretUrl }));
    } catch (error) {
      refusal = error;
    }

    assert.ok(refusal instanceof TestDatabaseSafetyError);
    assert.equal(refusal.message.includes('do-not-leak'), false);
    assert.equal(refusal.message.includes(secretUrl), false);
    assert.equal(refusal.message.includes('db.internal'), false);
  });

  test('sets DATABASE_URL only after validation and never falls back to it', () => {
    const validEnvironment = environment({ DATABASE_URL: 'postgresql://localhost/development' });
    configureTestDatabaseEnvironment(validEnvironment);
    assert.equal(validEnvironment.DATABASE_URL, VALID_URL);

    const invalidEnvironment = environment({
      TEST_DATABASE_URL: 'postgresql://localhost/development',
      DATABASE_URL: 'postgresql://localhost/original',
    });
    assert.throws(() => configureTestDatabaseEnvironment(invalidEnvironment), TestDatabaseSafetyError);
    assert.equal(invalidEnvironment.DATABASE_URL, 'postgresql://localhost/original');
  });

  test('rejects a development database before a destructive callback is invoked', () => {
    let cleanupInvoked = false;
    const unsafeEnvironment = environment({ TEST_DATABASE_URL: 'postgresql://localhost/eonrover' });

    assert.throws(
      () =>
        runDestructiveTestDatabaseOperation(unsafeEnvironment, () => {
          cleanupInvoked = true;
        }),
      TestDatabaseSafetyError,
    );
    assert.equal(cleanupInvoked, false);
  });
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DISPOSABLE_DATABASE_URL,
  assertDisposableDatabaseUrl,
  assertSafeProjectName,
  buildCleanupCommand,
  redactSecrets,
  resolveSafetyConfig,
} = require('../scripts/vertical-slice-safety.cjs');

test('vertical-slice safety refuses a missing explicit opt-in', () => {
  assert.throws(
    () => resolveSafetyConfig({ EONROVER_E2E_PROJECT: 'eonrover-e2e-safety-test' }),
    /ALLOW_DISPOSABLE_E2E=1/,
  );
});

test('vertical-slice safety refuses an invalid Compose project name', () => {
  assert.throws(() => assertSafeProjectName('eonrover_e2e_unsafe'), /eonrover-e2e-/);
  assert.throws(() => assertSafeProjectName('other-e2e-project'), /eonrover-e2e-/);
});

test('vertical-slice safety explicitly refuses the default development project', () => {
  assert.throws(() => assertSafeProjectName('eonrovercom'), /default Eon Rover development/);
});

test('vertical-slice safety accepts only the fixed disposable database service', () => {
  assert.equal(assertDisposableDatabaseUrl(DISPOSABLE_DATABASE_URL), DISPOSABLE_DATABASE_URL);
  assert.throws(
    () => assertDisposableDatabaseUrl('postgresql://eonrover:eonrover_dev_password@postgres:5432/eonrover'),
    /outside the fixed disposable E2E Compose service/,
  );
  assert.throws(
    () => assertDisposableDatabaseUrl('postgresql://eonrover_e2e:disposable_e2e_only@db.example/eonrover_e2e_test'),
    /outside the fixed disposable E2E Compose service/,
  );
  assert.throws(
    () => resolveSafetyConfig({
      ALLOW_DISPOSABLE_E2E: '1',
      EONROVER_E2E_PROJECT: 'eonrover-e2e-database-test',
      EONROVER_E2E_DATABASE_URL: 'postgresql://eonrover:eonrover_dev_password@postgres:5432/eonrover',
    }),
    /outside the fixed disposable E2E Compose service/,
  );
});

test('vertical-slice output redacts credentials, cookies, and verification tokens', () => {
  const password = 'GeneratedPasswordSecret';
  const output = redactSecrets(
    `password=${password} postgresql://user:pass@postgres/db ` +
      'Cookie: eonrover_sid=session-secret /verify-email?token=verification-secret ' +
      '{"token":"json-secret","password":"json-password"}',
    [password],
  );

  for (const secret of [
    password,
    'user:pass',
    'session-secret',
    'verification-secret',
    'json-secret',
    'json-password',
  ]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /\[REDACTED\]/);
});

test('vertical-slice cleanup is scoped to its safe Compose project and volumes', () => {
  const command = buildCleanupCommand(
    'eonrover-e2e-cleanup-test',
    ['/repo/docker-compose.yml', '/repo/docker-compose.e2e.yml'],
  );

  assert.deepEqual(command, {
    command: 'docker',
    args: [
      'compose',
      '--project-name',
      'eonrover-e2e-cleanup-test',
      '--file',
      '/repo/docker-compose.yml',
      '--file',
      '/repo/docker-compose.e2e.yml',
      'down',
      '--volumes',
      '--remove-orphans',
    ],
  });
  assert.equal(command.args.includes('system'), false);
  assert.equal(command.args.includes('prune'), false);
});

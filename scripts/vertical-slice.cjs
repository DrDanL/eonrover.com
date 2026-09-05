#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const {
  DISPOSABLE_DATABASE_NAME,
  DISPOSABLE_DATABASE_PASSWORD,
  DISPOSABLE_DATABASE_USER,
  buildCleanupCommand,
  buildComposeArgs,
  redactSecrets,
  resolveSafetyConfig,
} = require('./vertical-slice-safety.cjs');

const ROOT = path.resolve(__dirname, '..');
const COMPOSE_FILES = [
  path.join(ROOT, 'docker-compose.yml'),
  path.join(ROOT, 'docker-compose.e2e.yml'),
];
const READY_TIMEOUT_MS = 240_000;
const MAIL_TIMEOUT_MS = 30_000;
const COMPLETION_TIMEOUT_MS = 30_000;

let composeEnvironment;
let projectName;
let secrets = [DISPOSABLE_DATABASE_PASSWORD];
let stepNumber = 0;

function step(message) {
  stepNumber += 1;
  process.stdout.write(`[${stepNumber}] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function safeOutput(value) {
  return redactSecrets(value, secrets);
}

function commandFailure(command, result) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const diagnostic = safeOutput(combined.slice(-6_000));
  return new Error(`${command} failed with exit code ${result.status}.${diagnostic ? `\n${diagnostic}` : ''}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: options.env || composeEnvironment || process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout || 120_000,
  });
  if (result.error) throw new Error(`${command} could not start: ${safeOutput(result.error.message)}`);
  if (result.status !== 0 && !options.allowFailure) throw commandFailure(command, result);
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function compose(actionArgs, options = {}) {
  return run('docker', buildComposeArgs(projectName, COMPOSE_FILES, actionArgs), options);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function querySql(sql) {
  const result = compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '--username',
    DISPOSABLE_DATABASE_USER,
    '--dbname',
    DISPOSABLE_DATABASE_NAME,
    '--tuples-only',
    '--no-align',
    '--command',
    sql,
  ]);
  return result.stdout.trim();
}

function queryJson(sql) {
  const output = querySql(sql);
  const line = output.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
  if (!line) fail('The isolated database did not return the expected JSON record.');
  try {
    return JSON.parse(line);
  } catch {
    fail('The isolated database returned malformed verification data.');
  }
}

function snapshotContainers() {
  const output = run(
    'docker',
    ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.State}}'],
    { env: process.env },
  ).stdout;
  return new Map(
    output
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [id, name, state] = line.split('\t');
        return [id, { name, state }];
      }),
  );
}

function assertProjectDoesNotExist() {
  const label = `label=com.docker.compose.project=${projectName}`;
  const containers = run('docker', ['ps', '-a', '--filter', label, '--quiet'], { env: process.env }).stdout.trim();
  const networks = run('docker', ['network', 'ls', '--filter', label, '--quiet'], { env: process.env }).stdout.trim();
  const volumes = run('docker', ['volume', 'ls', '--filter', label, '--quiet'], { env: process.env }).stdout.trim();
  expect(
    !containers && !networks && !volumes,
    'Refusing to reuse an existing Compose project; choose a new eonrover-e2e-* name.',
  );
}

function assertUnrelatedContainersUnchanged(before) {
  const after = snapshotContainers();
  for (const [id, expected] of before) {
    const actual = after.get(id);
    expect(actual !== undefined, `Unrelated container ${expected.name} disappeared during verification.`);
    expect(
      actual.name === expected.name && actual.state === expected.state,
      `Unrelated container ${expected.name} changed state during verification.`,
    );
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePorts(count) {
  const reservations = [];
  for (let index = 0; index < count; index += 1) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') fail('Could not reserve an isolated loopback port.');
    reservations.push({ server, port: address.port });
  }
  return reservations;
}

async function releasePorts(reservations) {
  await Promise.all(
    reservations.map(
      ({ server }) => new Promise((resolve) => server.close(resolve)),
    ),
  );
}

async function waitForHttp(url, label, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      lastStatus = String(response.status);
      if (response.ok) return;
    } catch {
      lastStatus = 'unreachable';
    }
    await sleep(1_000);
  }
  fail(`${label} did not become ready within ${Math.round(timeoutMs / 1_000)} seconds (${lastStatus}).`);
}

async function apiRequest(apiUrl, route, options = {}) {
  const headers = { 'X-Eonrover-Client': '1' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${apiUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });
  let body = null;
  const responseText = await response.text();
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      fail(`The API returned non-JSON content for ${route}.`);
    }
  }
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    const code = body && typeof body.code === 'string' ? ` (${body.code})` : '';
    fail(`Expected HTTP ${expectedStatus} from ${route}, received ${response.status}${code}.`);
  }
  return { body, headers: response.headers };
}

function sessionCookieFrom(headers) {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) fail('Login did not return a session cookie.');
  const pair = setCookie.split(';', 1)[0];
  if (!pair.startsWith('eonrover_sid=')) fail('Login returned an unexpected session cookie.');
  const rawToken = decodeURIComponent(pair.slice('eonrover_sid='.length));
  expect(rawToken.length > 0, 'Login returned an empty session token.');
  secrets.push(pair, rawToken);
  return { pair, rawToken };
}

async function login(apiUrl, email, password) {
  const response = await apiRequest(apiUrl, '/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return sessionCookieFrom(response.headers);
}

function mailRecipients(message) {
  if (!message || !Array.isArray(message.To)) return [];
  return message.To.flatMap((recipient) => {
    if (typeof recipient === 'string') return [recipient.toLowerCase()];
    if (recipient && typeof recipient.Address === 'string') return [recipient.Address.toLowerCase()];
    return [];
  });
}

async function waitForVerificationToken(mailpitUrl, email) {
  const deadline = Date.now() + MAIL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=50`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const listing = await response.json();
      const messages = Array.isArray(listing.messages) ? listing.messages : [];
      const matching = messages.filter((message) => mailRecipients(message).includes(email.toLowerCase()));
      if (matching.length > 1) fail('Mailpit received more than one verification message for the test account.');
      if (matching.length === 1) {
        const messageId = matching[0].ID || matching[0].Id || matching[0].id;
        expect(typeof messageId === 'string' && messageId.length > 0, 'Mailpit returned a message without an ID.');
        const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(messageId)}`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(detailResponse.ok, 'Mailpit could not return the verification message.');
        const detail = await detailResponse.json();
        const content = `${detail.Text || ''}\n${detail.HTML || ''}\n${JSON.stringify(detail)}`;
        const token = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(content)?.[1];
        expect(token, 'The Mailpit message did not contain a verification link.');
        secrets.push(token);
        return token;
      }
    }
    await sleep(500);
  }
  fail('Mailpit did not receive the verification message within 30 seconds.');
}

function sessionDigest(rawToken) {
  return `sha256:${createHash('sha256').update(rawToken).digest('hex')}`;
}

function parseDatabaseTimestamp(value) {
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(text) ? text : `${text}Z`);
}

function currentSession(userId) {
  return queryJson(`
    SELECT row_to_json(session_row)
    FROM (
      SELECT "id", "expiresAt"
      FROM "Session"
      WHERE "userId" = ${sqlLiteral(userId)}
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) AS session_row
  `);
}

function completedState(userId, planetId, constructionId) {
  return queryJson(`
    SELECT json_build_object(
      'buildingLevel', (
        SELECT "level" FROM "Building"
        WHERE "planetId" = ${sqlLiteral(planetId)} AND "key" = 'alloyMine'
      ),
      'constructionStatus', (
        SELECT "status" FROM "BuildQueueItem" WHERE "id" = ${sqlLiteral(constructionId)}
      ),
      'notificationCount', (
        SELECT COUNT(*)::int FROM "Notification"
        WHERE "userId" = ${sqlLiteral(userId)} AND "type" = 'BUILDING_COMPLETE'
      )
    )
  `);
}

function playerStateViewAuditCount(adminId, playerId) {
  return Number(querySql(`
    SELECT COUNT(*)::int
    FROM "AuditLog"
    WHERE "actorId" = ${sqlLiteral(adminId)}
      AND "targetId" = ${sqlLiteral(playerId)}
      AND "targetType" = 'User'
      AND "action" = 'PLAYER_STATE_VIEWED'
      AND "metadata" IS NULL
  `));
}

function assertAdminPlayerStateSafe(body, expected, sensitiveValues) {
  expect(body?.player?.id === expected.userId, 'The administrator view returned the wrong player.');
  expect(body.player.planetCount === 1, 'The administrator view did not report exactly one planet.');
  expect(Array.isArray(body.planets) && body.planets.length === 1, 'The administrator view did not return one planet.');
  const planet = body.planets[0];
  expect(planet.id === expected.planetId && planet.isHomeworld === true, 'The administrator view returned the wrong homeworld.');
  expect(
    planet.buildings.some((building) => building.key === 'alloyMine' && building.level === 1),
    'The administrator view did not report the completed Alloy Mine.',
  );
  expect(planet.activeConstruction === null, 'The administrator view reported completed construction as active.');

  const forbiddenKeys = new Set([
    'passwordhash',
    'sessions',
    'sessionid',
    'verificationtokens',
    'resettoken',
    'token',
    'jobid',
    'metadata',
  ]);
  function inspect(value) {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      expect(!forbiddenKeys.has(key.toLowerCase()), `The administrator response exposed forbidden field ${key}.`);
      inspect(child);
    }
  }
  inspect(body);

  const serialized = JSON.stringify(body);
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) expect(!serialized.includes(sensitiveValue), 'The administrator response exposed a credential or token.');
  }
  expect(!serialized.includes('eonrover_sid='), 'The administrator response exposed a session cookie.');
  return planet;
}

async function waitForWorkerCompletion(userId, planetId, constructionId) {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = completedState(userId, planetId, constructionId);
    if (state.constructionStatus === 'COMPLETE') return state;
    if (state.constructionStatus !== 'PENDING') {
      fail('The building construction reached an unexpected terminal state.');
    }
    await sleep(500);
  }
  fail('The worker did not complete the due construction within 30 seconds.');
}

function nudgeBuildingJob(constructionId) {
  const jobId = `building-${constructionId}`;
  const script = `
    const { Queue } = require('bullmq');
    const queue = new Queue('build-queue', { connection: { host: 'redis', port: 6379 } });
    (async () => {
      const job = await queue.getJob(process.argv[1]);
      if (!job) throw new Error('Expected deterministic building job is missing');
      await job.changeDelay(0);
    })().finally(() => queue.close());
  `;
  compose(['exec', '-T', 'worker', 'node', '-e', script, jobId]);
}

function cleanupProject() {
  const cleanup = buildCleanupCommand(projectName, COMPOSE_FILES);
  run(cleanup.command, cleanup.args, { allowFailure: false });

  const filters = ['--filter', `label=com.docker.compose.project=${projectName}`, '--quiet'];
  const containers = run('docker', ['ps', '-a', ...filters], { env: process.env }).stdout.trim();
  const networks = run('docker', ['network', 'ls', ...filters], { env: process.env }).stdout.trim();
  const volumes = run('docker', ['volume', 'ls', ...filters], { env: process.env }).stdout.trim();
  expect(!containers && !networks && !volumes, 'Disposable Compose resources remain after scoped cleanup.');
}

async function writeFailureDiagnostics() {
  if (!projectName || !composeEnvironment) return;
  const result = compose(
    ['logs', '--no-color', '--tail', '80', 'api', 'worker', 'web', 'postgres', 'redis', 'mailpit'],
    { allowFailure: true },
  );
  const output = safeOutput(`${result.stdout}\n${result.stderr}`.trim());
  if (output) process.stderr.write(`\nSanitized service diagnostics:\n${output}\n`);
}

async function runWorkflow(urls, credentials) {
  const { apiUrl, mailpitUrl, webUrl, workerUrl } = urls;
  const { email, username, password, adminEmail, adminPassword } = credentials;

  step('Building and starting the isolated six-service stack.');
  compose(['up', '--build', '--detach'], { timeout: 600_000 });

  step('Waiting for API, worker, and public web readiness.');
  await Promise.all([
    waitForHttp(`${apiUrl}/readyz`, 'API readiness'),
    waitForHttp(`${workerUrl}/readyz`, 'Worker readiness'),
    waitForHttp(webUrl, 'Public web application'),
  ]);

  step('Registering one generated player through the public API.');
  const registration = await apiRequest(apiUrl, '/api/auth/register', {
    method: 'POST',
    expectedStatus: 201,
    body: { email, username, password },
  });
  expect(registration.body?.verificationEmailSent === true, 'Registration did not send a verification email.');
  const registrationRows = queryJson(`
    SELECT json_build_object(
      'userCount', (
        SELECT COUNT(*)::int FROM "User" WHERE "email" = ${sqlLiteral(email)}
      ),
      'homeworldCount', (
        SELECT COUNT(*)::int
        FROM "Planet" planet
        JOIN "User" account ON account."id" = planet."ownerId"
        WHERE account."email" = ${sqlLiteral(email)} AND planet."isHomeworld" = TRUE
      ),
      'planetCount', (
        SELECT COUNT(*)::int
        FROM "Planet" planet
        JOIN "User" account ON account."id" = planet."ownerId"
        WHERE account."email" = ${sqlLiteral(email)}
      )
    )
  `);
  expect(registrationRows.userCount === 1, 'Registration did not create exactly one user.');
  expect(
    registrationRows.homeworldCount === 1 && registrationRows.planetCount === 1,
    'Registration did not create exactly one homeworld.',
  );

  step('Following the one real Mailpit verification message and rejecting token reuse.');
  const verificationToken = await waitForVerificationToken(mailpitUrl, email);
  await apiRequest(apiUrl, '/api/auth/verify-email', {
    method: 'POST',
    body: { token: verificationToken },
  });
  await apiRequest(apiUrl, '/api/auth/verify-email', {
    method: 'POST',
    expectedStatus: 400,
    body: { token: verificationToken },
  });

  step('Logging in with normalized email input and validating the protected session.');
  let session = await login(apiUrl, `  ${email.toUpperCase()}  `, password);
  const me = await apiRequest(apiUrl, '/api/auth/me', { cookie: session.pair });
  const userId = me.body?.user?.id;
  expect(typeof userId === 'string', 'The authenticated profile did not return a user ID.');
  await apiRequest(apiUrl, `/api/admin/users?q=${encodeURIComponent(email)}`, {
    expectedStatus: 403,
    cookie: session.pair,
  });
  const planets = await apiRequest(apiUrl, '/api/planets', { cookie: session.pair });
  expect(Array.isArray(planets.body?.planets) && planets.body.planets.length === 1, 'The player does not have exactly one planet.');
  const planetId = planets.body.planets[0].id;
  const storedSession = currentSession(userId);
  expect(storedSession.id === sessionDigest(session.rawToken), 'PostgreSQL did not store the session-token digest.');
  expect(storedSession.id !== session.rawToken, 'PostgreSQL stored a raw bearer session token.');

  step('Starting one Alloy Mine upgrade and checking deduction and queue exclusivity.');
  const beforeBuild = await apiRequest(apiUrl, `/api/planets/${planetId}`, { cookie: session.pair });
  const beforeAlloy = beforeBuild.body.planet.alloy;
  const beforeHeliox = beforeBuild.body.planet.heliox;
  const started = await apiRequest(apiUrl, `/api/planets/${planetId}/buildings`, {
    method: 'POST',
    expectedStatus: 201,
    cookie: session.pair,
    body: { key: 'alloyMine' },
  });
  const constructionId = started.body?.queueItem?.id;
  expect(typeof constructionId === 'string', 'Building start did not return a construction ID.');
  const queued = queryJson(`
    SELECT json_build_object(
      'pendingCount', (
        SELECT COUNT(*)::int FROM "BuildQueueItem"
        WHERE "planetId" = ${sqlLiteral(planetId)} AND "status" = 'PENDING'
      ),
      'status', queue."status",
      'costAlloy', queue."costAlloy",
      'costHeliox', queue."costHeliox",
      'planetAlloy', planet."alloy",
      'planetHeliox', planet."heliox"
    )
    FROM "BuildQueueItem" queue
    JOIN "Planet" planet ON planet."id" = queue."planetId"
    WHERE queue."id" = ${sqlLiteral(constructionId)}
  `);
  expect(queued.pendingCount === 1 && queued.status === 'PENDING', 'The construction was not persisted once as PENDING.');
  assert.equal(queued.planetAlloy, beforeAlloy - queued.costAlloy, 'Alloy was not deducted exactly once.');
  assert.equal(queued.planetHeliox, beforeHeliox - queued.costHeliox, 'Heliox was not deducted exactly once.');
  const duplicateStart = await apiRequest(apiUrl, `/api/planets/${planetId}/buildings`, {
    method: 'POST',
    expectedStatus: 409,
    cookie: session.pair,
    body: { key: 'alloyMine' },
  });
  expect(
    duplicateStart.body?.code === 'CONSTRUCTION_IN_PROGRESS',
    'A second building action did not return CONSTRUCTION_IN_PROGRESS.',
  );

  step('Making only that construction due and allowing the worker to complete it.');
  const changed = Number(querySql(`
    WITH changed AS (
      UPDATE "BuildQueueItem"
      SET "completesAt" = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE "id" = ${sqlLiteral(constructionId)} AND "status" = 'PENDING'
      RETURNING "id"
    )
    SELECT COUNT(*)::int FROM changed
  `));
  expect(changed === 1, 'The isolated completion timestamp adjustment did not target exactly one row.');
  nudgeBuildingJob(constructionId);
  const completed = await waitForWorkerCompletion(userId, planetId, constructionId);
  expect(completed.buildingLevel === 1, 'The worker did not increment the Alloy Mine exactly once.');
  expect(completed.notificationCount === 1, 'The worker did not create exactly one completion notification.');
  const notificationResponse = await apiRequest(apiUrl, '/api/notifications', { cookie: session.pair });
  expect(
    notificationResponse.body.notifications.filter((item) => item.type === 'BUILDING_COMPLETE').length === 1,
    'The completion notification is not visible through the public API exactly once.',
  );

  step('Verifying timestamp-based resource production without double-accruing an interval.');
  const afterCompletion = await apiRequest(apiUrl, `/api/planets/${planetId}/buildings`, {
    cookie: session.pair,
  });
  const productionBase = afterCompletion.body.planet.alloy;
  const backdated = queryJson(`
    UPDATE "Planet"
    SET "lastProductionAt" = CURRENT_TIMESTAMP - INTERVAL '120 seconds'
    WHERE "id" = ${sqlLiteral(planetId)}
    RETURNING json_build_object('lastProductionAt', "lastProductionAt")
  `);
  const firstProductionRead = await apiRequest(apiUrl, `/api/planets/${planetId}/buildings`, {
    cookie: session.pair,
  });
  const elapsedHours =
    (new Date(firstProductionRead.body.planet.lastProductionAt).getTime() -
      parseDatabaseTimestamp(backdated.lastProductionAt).getTime()) /
    3_600_000;
  const expectedAlloy = Math.min(
    firstProductionRead.body.storage.alloy,
    productionBase + firstProductionRead.body.production.alloy * elapsedHours,
  );
  expect(firstProductionRead.body.planet.alloy > productionBase, 'Server-authoritative resources did not increase.');
  const productionDifference = Math.abs(firstProductionRead.body.planet.alloy - expectedAlloy);
  expect(
    productionDifference < 0.000001,
    'The resource gain did not match the server rate: ' +
      `base=${productionBase.toFixed(6)}, actual=${firstProductionRead.body.planet.alloy.toFixed(6)}, ` +
      `rate=${firstProductionRead.body.production.alloy.toFixed(6)}, elapsed=${elapsedHours.toFixed(6)}h, ` +
      `expected=${expectedAlloy.toFixed(6)}, difference=${productionDifference.toExponential(3)}.`,
  );
  const firstGain = firstProductionRead.body.planet.alloy - productionBase;
  const immediateRead = await apiRequest(apiUrl, `/api/planets/${planetId}/buildings`, {
    cookie: session.pair,
  });
  const immediateGain = immediateRead.body.planet.alloy - firstProductionRead.body.planet.alloy;
  expect(immediateGain >= 0 && immediateGain < Math.max(0.05, firstGain / 10), 'An immediate read duplicated elapsed production.');
  const persistedResources = queryJson(`
    SELECT json_build_object(
      'alloy', "alloy",
      'heliox', "heliox",
      'aether', "aether",
      'lastProductionAt', "lastProductionAt"
    )
    FROM "Planet"
    WHERE "id" = ${sqlLiteral(planetId)}
  `);
  assert.equal(persistedResources.alloy, immediateRead.body.planet.alloy, 'API Alloy did not match PostgreSQL.');
  assert.equal(persistedResources.heliox, immediateRead.body.planet.heliox, 'API Heliox did not match PostgreSQL.');
  assert.equal(persistedResources.aether, immediateRead.body.planet.aether, 'API Aether did not match PostgreSQL.');

  step('Inspecting the completed player state through the provisioned administrator account.');
  const adminSession = await login(apiUrl, adminEmail, adminPassword);
  const adminProfile = await apiRequest(apiUrl, '/api/auth/me', { cookie: adminSession.pair });
  const adminId = adminProfile.body?.user?.id;
  expect(adminProfile.body?.user?.role === 'ADMIN' && typeof adminId === 'string', 'The provisioned account is not an administrator.');
  const adminSearch = await apiRequest(
    apiUrl,
    `/api/admin/users?q=${encodeURIComponent(`  ${email.toUpperCase()}  `)}&page=1&pageSize=20`,
    { cookie: adminSession.pair },
  );
  expect(
    Array.isArray(adminSearch.body?.users) &&
      adminSearch.body.users.length === 1 &&
      adminSearch.body.users[0].id === userId,
    'Administrator search did not return exactly the vertical-slice player.',
  );
  const adminStateBeforeRestart = await apiRequest(apiUrl, `/api/admin/users/${userId}`, {
    cookie: adminSession.pair,
  });
  const inspectedPlanetBeforeRestart = assertAdminPlayerStateSafe(
    adminStateBeforeRestart.body,
    { userId, planetId },
    [password, adminPassword, session.rawToken, adminSession.rawToken, verificationToken],
  );
  expect(playerStateViewAuditCount(adminId, userId) === 1, 'The first administrator detail open did not create exactly one safe audit event.');

  step('Logging out and back in before the restart boundary.');
  await apiRequest(apiUrl, '/api/auth/logout', { method: 'POST', cookie: session.pair });
  await apiRequest(apiUrl, '/api/auth/me', { expectedStatus: 401, cookie: session.pair });
  session = await login(apiUrl, email, password);
  await apiRequest(apiUrl, '/api/auth/me', { cookie: session.pair });
  const sessionBeforeRestart = currentSession(userId);
  expect(sessionBeforeRestart.id === sessionDigest(session.rawToken), 'The replacement session was not stored as a digest.');
  const stateBeforeRestart = {
    userId,
    planetId,
    alloy: inspectedPlanetBeforeRestart.resources.alloy,
    heliox: inspectedPlanetBeforeRestart.resources.heliox,
    aether: inspectedPlanetBeforeRestart.resources.aether,
    lastProductionAt: inspectedPlanetBeforeRestart.lastProductionAt,
    buildingLevel: completed.buildingLevel,
    sessionExpiry: sessionBeforeRestart.expiresAt,
  };

  step('Stopping and restarting the same Compose project without deleting volumes.');
  compose(['stop', '--timeout', '20']);
  compose(['up', '--detach'], { timeout: 180_000 });
  await Promise.all([
    waitForHttp(`${apiUrl}/readyz`, 'API readiness after restart'),
    waitForHttp(`${workerUrl}/readyz`, 'Worker readiness after restart'),
    waitForHttp(webUrl, 'Public web application after restart'),
  ]);

  step('Confirming account, session, planet, production, and completion persistence.');
  const meAfterRestart = await apiRequest(apiUrl, '/api/auth/me', { cookie: session.pair });
  expect(meAfterRestart.body.user.id === stateBeforeRestart.userId, 'The persisted session resolved to a different account.');
  const planetsAfterRestart = await apiRequest(apiUrl, '/api/planets', { cookie: session.pair });
  expect(
    planetsAfterRestart.body.planets.length === 1 && planetsAfterRestart.body.planets[0].id === stateBeforeRestart.planetId,
    'The persisted account did not retain exactly the same homeworld.',
  );
  const planetAfterRestart = await apiRequest(apiUrl, `/api/planets/${planetId}`, { cookie: session.pair });
  expect(planetAfterRestart.body.planet.alloy >= stateBeforeRestart.alloy, 'Alloy regressed across restart.');
  expect(planetAfterRestart.body.planet.heliox >= stateBeforeRestart.heliox, 'Heliox regressed across restart.');
  expect(planetAfterRestart.body.planet.aether >= stateBeforeRestart.aether, 'Aether regressed across restart.');
  expect(
    new Date(planetAfterRestart.body.planet.lastProductionAt).getTime() >
      new Date(stateBeforeRestart.lastProductionAt).getTime(),
    'Resource production did not continue from its persisted timestamp after restart.',
  );
  const persistedCompletion = completedState(userId, planetId, constructionId);
  expect(
    persistedCompletion.buildingLevel === stateBeforeRestart.buildingLevel &&
      persistedCompletion.constructionStatus === 'COMPLETE' &&
      persistedCompletion.notificationCount === 1,
    'The completed construction changed or ran twice after restart.',
  );
  const sessionAfterRestart = currentSession(userId);
  expect(
    sessionAfterRestart.id === sessionDigest(session.rawToken) &&
      sessionAfterRestart.expiresAt === stateBeforeRestart.sessionExpiry,
    'The session token or expiry changed across restart.',
  );

  const adminSearchAfterRestart = await apiRequest(
    apiUrl,
    `/api/admin/users?q=${encodeURIComponent(email)}&page=1&pageSize=20`,
    { cookie: adminSession.pair },
  );
  expect(
    adminSearchAfterRestart.body?.users?.[0]?.id === userId,
    'Administrator search did not find the persisted player after restart.',
  );
  const adminStateAfterRestart = await apiRequest(apiUrl, `/api/admin/users/${userId}`, {
    cookie: adminSession.pair,
  });
  const inspectedPlanetAfterRestart = assertAdminPlayerStateSafe(
    adminStateAfterRestart.body,
    { userId, planetId },
    [password, adminPassword, session.rawToken, adminSession.rawToken, verificationToken],
  );
  expect(inspectedPlanetAfterRestart.resources.alloy >= stateBeforeRestart.alloy, 'Administrator Alloy state regressed across restart.');
  expect(inspectedPlanetAfterRestart.resources.heliox >= stateBeforeRestart.heliox, 'Administrator Heliox state regressed across restart.');
  expect(playerStateViewAuditCount(adminId, userId) === 2, 'Administrator detail opens did not create one safe audit event each.');

  step('Logging out after restart, rejecting the old session, and signing in again.');
  await apiRequest(apiUrl, '/api/auth/logout', { method: 'POST', cookie: session.pair });
  await apiRequest(apiUrl, '/api/auth/me', { expectedStatus: 401, cookie: session.pair });
  const finalSession = await login(apiUrl, email, password);
  const finalPlanets = await apiRequest(apiUrl, '/api/planets', { cookie: finalSession.pair });
  expect(
    finalPlanets.body.planets.length === 1 && finalPlanets.body.planets[0].id === planetId,
    'The final login did not return the same homeworld.',
  );
}

async function main() {
  let unrelatedBefore;
  let validProject = false;
  let workflowError;
  let cleanupError;
  const reservations = [];

  try {
    const safety = resolveSafetyConfig(process.env);
    projectName = safety.projectName;
    validProject = true;
    secrets.push(safety.databaseUrl);

    unrelatedBefore = snapshotContainers();
    assertProjectDoesNotExist();
    reservations.push(...(await reservePorts(7)));
    const [postgres, redis, mailpitHttp, mailpitSmtp, api, worker, web] = reservations.map(({ port }) => port);
    const apiUrl = `http://127.0.0.1:${api}`;
    const workerUrl = `http://127.0.0.1:${worker}`;
    const webUrl = `http://127.0.0.1:${web}`;
    const mailpitUrl = `http://127.0.0.1:${mailpitHttp}`;
    const suffix = randomBytes(6).toString('hex');
    const email = `vertical-${suffix}@example.invalid`;
    const username = `v_${suffix}`;
    const password = `${randomBytes(18).toString('base64url')}A1!`;
    const adminEmail = `admin-${suffix}@example.invalid`;
    const adminUsername = `a_${suffix}`;
    const adminPassword = `${randomBytes(18).toString('base64url')}A1!`;
    secrets.push(email, username, password, adminEmail, adminUsername, adminPassword);

    composeEnvironment = {
      ...process.env,
      COMPOSE_PROJECT_NAME: projectName,
      BIND_ADDRESS: '127.0.0.1',
      POSTGRES_USER: DISPOSABLE_DATABASE_USER,
      POSTGRES_PASSWORD: DISPOSABLE_DATABASE_PASSWORD,
      POSTGRES_DB: DISPOSABLE_DATABASE_NAME,
      POSTGRES_HOST_PORT: String(postgres),
      REDIS_URL: 'redis://redis:6379',
      REDIS_HOST_PORT: String(redis),
      MAILPIT_HTTP_HOST_PORT: String(mailpitHttp),
      MAILPIT_SMTP_HOST_PORT: String(mailpitSmtp),
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
      MAIL_FROM: 'no-reply@eonrover.invalid',
      PORT: String(api),
      WORKER_HEALTH_PORT: String(worker),
      WEB_HOST_PORT: String(web),
      WEB_URL: webUrl,
      NEXT_PUBLIC_API_URL: apiUrl,
      COOKIE_SECURE: 'false',
      NODE_ENV: 'development',
      ADMIN_EMAIL: adminEmail,
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword,
    };
    delete composeEnvironment.DATABASE_URL;
    delete composeEnvironment.TEST_DATABASE_URL;
    delete composeEnvironment.ALLOW_TEST_DATABASE_RESET;

    await releasePorts(reservations);
    reservations.length = 0;
    await runWorkflow(
      { apiUrl, workerUrl, webUrl, mailpitUrl },
      { email, username, password, adminEmail, adminPassword },
    );
  } catch (error) {
    workflowError = error;
    await writeFailureDiagnostics().catch(() => undefined);
  } finally {
    if (reservations.length > 0) await releasePorts(reservations).catch(() => undefined);
    if (validProject && composeEnvironment) {
      try {
        step('Removing only the disposable project containers, network, and volumes.');
        cleanupProject();
        if (unrelatedBefore) assertUnrelatedContainersUnchanged(unrelatedBefore);
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (workflowError) {
    process.stderr.write(`Vertical-slice verification failed: ${safeOutput(workflowError.message)}\n`);
    if (cleanupError) process.stderr.write(`Cleanup also failed: ${safeOutput(cleanupError.message)}\n`);
    process.exitCode = 1;
    return;
  }
  if (cleanupError) {
    process.stderr.write(`Vertical-slice cleanup failed: ${safeOutput(cleanupError.message)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('PASS: disposable vertical slice, restart persistence, and scoped cleanup verified.\n');
}

void main();

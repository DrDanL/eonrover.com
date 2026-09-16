'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const adminDirectory = path.join(__dirname, '../apps/web/src/app/(admin)/admin');
const files = [
  'page.tsx',
  'users/page.tsx',
  'jobs/page.tsx',
  'audit/page.tsx',
  'security/page.tsx',
  'config/page.tsx',
  'announcements/page.tsx',
].map((file) => path.join(adminDirectory, file));

test('administrator portal pages do not call legacy management APIs or render raw operational data', () => {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /api(?:Get|Post|Patch|Delete)/);
    assert.doesNotMatch(source, /\/api\/admin/);
    assert.doesNotMatch(source, /JSON\.stringify|<pre|\.map\(|jobId|missionId/i);
  }
});

test('the portal is ADMIN-only and has a server-rendered local-first runtime policy', () => {
  const layout = readFileSync(path.join(adminDirectory, 'layout.tsx'), 'utf8');
  const clientLayout = readFileSync(path.join(__dirname, '../apps/web/src/components/AdminPortalLayoutClient.tsx'), 'utf8');
  const policy = readFileSync(path.join(__dirname, '../apps/web/src/lib/adminPortalPolicy.ts'), 'utf8');
  const gameShell = readFileSync(path.join(__dirname, '../apps/web/src/components/GameShell.tsx'), 'utf8');

  assert.match(layout, /isAdminPortalRuntimeEnabled/);
  assert.match(clientLayout, /user\.role !== 'ADMIN'/);
  assert.doesNotMatch(clientLayout, /MODERATOR/);
  assert.match(policy, /NODE_ENV !== 'production' \|\| process\.env\.ADMIN_PORTAL_ENABLED === 'true'/);
  assert.match(gameShell, /user\.role === 'ADMIN'/);
});

test('the retained API router has only allowlisted read projections and no operational dependencies', () => {
  const route = readFileSync(path.join(__dirname, '../apps/api/src/routes/admin.ts'), 'utf8');

  assert.match(route, /requireAdminPortalRuntime, requireReadOnlyAuth, requireRole\('ADMIN'\)/);
  assert.match(route, /router\.get\('\/status'/);
  assert.match(route, /router\.get\('\/overview'/);
  assert.match(route, /router\.get\('\/players'/);
  assert.doesNotMatch(route, /lib\/redis|adminPlayerStateService|syncPlanetResources|logAudit|buildQueue|fleetQueue/i);
  assert.doesNotMatch(route, /router\.use\(\(_req, res\)/);
  assert.doesNotMatch(route, /MODERATOR/);
});

test('only the retained administrator route files remain in the route group', () => {
  assert.deepEqual(readdirSync(adminDirectory).sort(), [
    'announcements', 'audit', 'config', 'jobs', 'layout.tsx', 'page.tsx', 'security', 'users',
  ]);
});

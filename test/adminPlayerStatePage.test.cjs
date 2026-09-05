'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pageSource = readFileSync(
  path.join(__dirname, '../apps/web/src/app/(admin)/admin/users/page.tsx'),
  'utf8',
);

test('administrator player-state detail is read-only and opened only by an explicit action', () => {
  assert.doesNotMatch(pageSource, /\bapi(?:Post|Patch|Delete)\b/);
  assert.doesNotMatch(pageSource, /\/status\b|\/rename\b|\bSuspend\b|\bBan\b|Delete player|Impersonat/i);
  assert.doesNotMatch(pageSource, /\buseEffect\b/);
  assert.equal((pageSource.match(/apiGet<AdminPlayerState>/g) || []).length, 1);
  assert.match(pageSource, /onClick=\{\(\) => void openPlayer\(entry\.id\)\}/);
});

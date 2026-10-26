const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newerVersion, assessRelease, checkLatestRelease } = require('../dist-electron/electron/updates.js');

const release = (version, assets = [`harbor-ssh-${version}-mac-arm64.dmg`]) => ({
  tag_name: `v${version}`, draft: false, prerelease: false, assets: assets.map(name => ({ name }))
});

test('compares numeric versions and ignores malformed tags', () => {
  assert.equal(newerVersion('0.10.0', '0.9.9'), true);
  assert.equal(newerVersion('0.4.3', '0.4.5'), false);
  assert.equal(newerVersion('v0.4.5', '0.4.5'), false);
  assert.equal(newerVersion('0.5.0-beta', '0.4.5'), false);
});

test('only offers a stable newer release with a compatible installer', () => {
  const ready = assessRelease(release('0.4.6'), '0.4.5', 'darwin', 'arm64', 123);
  assert.deepEqual(ready.result, { currentVersion: '0.4.5', latestVersion: '0.4.6', status: 'available', checkedAt: 123 });
  assert.equal(ready.page, 'https://github.com/miketam/harbor-ssh/releases/tag/v0.4.6');
  assert.equal(assessRelease(release('0.4.6'), '0.4.5', 'darwin', 'x64').result.status, 'unsupported');
  assert.equal(assessRelease(release('0.4.6', ['harbor-ssh-0.4.6-win-x64-setup.exe']), '0.4.5', 'win32', 'x64').result.status, 'available');
  assert.equal(assessRelease(release('0.4.3'), '0.4.5', 'darwin', 'arm64').result.status, 'up-to-date');
  assert.throws(() => assessRelease({ ...release('0.4.6'), prerelease: true }, '0.4.5', 'darwin', 'arm64'));
  assert.throws(() => assessRelease(release('0.4.6-beta'), '0.4.5', 'darwin', 'arm64'));
});

test('rejects oversized remote response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('x'.repeat(512 * 1024 + 1), { status: 200 });
  try { await assert.rejects(checkLatestRelease('0.4.5'), /更新信息过大/); }
  finally { global.fetch = originalFetch; }
});

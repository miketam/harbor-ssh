const { _electron: electron } = require('playwright');
const { strict: assert } = require('node:assert');
const { mkdirSync, mkdtempSync, readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts'); mkdirSync(artifacts, { recursive: true });
const dataDir = mkdtempSync(join(artifacts, 'profile-'));
const env = { ...process.env, HARBOR_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let app; let fixture; let page;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  page = await app.firstWindow(); await require('./ui-helpers.cjs').dismissWelcome(page); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '终端，准备就绪。' }).waitFor();
}
async function connect(trustExpected = false, password = 'fixture-password-only') {
  await page.getByRole('button', { name: /^连接主机/ }).click();
  await page.getByLabel('临时密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '开始连接' }).click();
  if (trustExpected) { await page.getByRole('dialog', { name: '确认服务器身份' }).waitFor(); }
}
function scanFiles(dir, token) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) scanFiles(path, token);
    else if (!['LOCK', 'SingletonLock', 'SingletonSocket', 'SingletonCookie'].includes(item.name)) assert.equal(readFileSync(path).includes(Buffer.from(token)), false, `Unexpected persisted test password in ${item.name}`);
  }
}
(async () => {
  fixture = await serverFixture();
  await launch();
  await page.screenshot({ path: join(artifacts, '01-empty.png') });
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click();
  await page.getByLabel('主机名称', { exact: true }).fill('本地 SSH 验证');
  await page.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('用户名', { exact: true }).fill('fixture');
  await page.getByLabel('端口', { exact: true }).fill(String(fixture.port));
  await page.getByLabel('分组', { exact: false }).fill('集成测试');
  await page.getByRole('button', { name: '保存主机', exact: true }).click();
  await page.getByRole('heading', { name: '本地 SSH 验证', exact: true }).waitFor();
  await page.getByLabel('搜索主机').fill('no-match'); await page.getByText('没有匹配的主机。').waitFor();
  await page.getByLabel('搜索主机').fill('');
  await connect(true);
  assert.equal(fixture.stats.authenticated, 0);
  await page.screenshot({ path: join(artifacts, '02-fingerprint.png') });
  await page.getByRole('button', { name: '取消连接', exact: true }).last().click();
  await page.locator('.terminal-status').getByText('已断开', { exact: true }).waitFor();
  assert.equal(fixture.stats.authenticated, 0);
  await connect(true);
  await page.getByRole('button', { name: '信任并连接', exact: true }).click();
  await page.locator('.terminal-status').getByText('已连接', { exact: true }).waitFor();
  const known = await page.evaluate(() => window.harbor.listKnownHosts()); assert.equal(known.length, 1);
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('terminal-wire-check'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-screen')?.textContent?.includes('terminal-wire-check'));
  await page.screenshot({ path: join(artifacts, '03-connected.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false); await page.screenshot({ path: join(artifacts, '04-minimum.png') });
  await page.getByRole('button', { name: /断开连接/ }).click();
  await page.locator('.terminal-status').getByText('已断开', { exact: true }).waitFor();
  await app.close(); app = undefined;
  // Reopening the same profile must retain metadata and trust, never the password.
  app = await electron.launch({ executablePath: require('electron'), args: [root], env }); page = await app.firstWindow(); await require('./ui-helpers.cjs').dismissWelcome(page); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '本地 SSH 验证', exact: true }).waitFor();
  assert.equal(await page.locator('input[type=password]').count(), 0);
  await connect(false, 'fixture-wrong-password');
  await page.getByRole('alert').filter({ hasText: '认证失败' }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '确认服务器身份' }).count(), 0);
  await connect(); await page.locator('.terminal-status').getByText('已连接', { exact: true }).waitFor();
  await page.getByRole('button', { name: /断开连接/ }).click(); await page.locator('.terminal-status').getByText('已断开', { exact: true }).waitFor();
  // Same address/port, different host key must be blocked before authentication.
  const port = fixture.port; await fixture.close(); fixture = await serverFixture({ port });
  await connect(); await page.getByRole('alert').filter({ hasText: '主机指纹已变化' }).waitFor();
  assert.equal(fixture.stats.authenticated, 0);
  await page.getByRole('button', { name: /已信任主机/ }).click();
  await page.getByRole('button', { name: '移除信任', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click(); await page.getByText('尚未保存主机指纹。').waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('主机名称', { exact: true }).fill('已编辑的验证主机');
  await page.getByRole('button', { name: '保存主机', exact: true }).click();
  await page.getByRole('heading', { name: '已编辑的验证主机', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('button', { name: '删除主机', exact: true }).click();
  await page.getByText('添加第一台服务器，').waitFor();
  assert.deepEqual(errors, []);
  await app.close(); app = undefined;
  scanFiles(dataDir, 'fixture-password-only'); scanFiles(dataDir, 'fixture-wrong-password');
  const report = { result: 'passed', profile: dataDir, checks: ['host CRUD and search', 'fingerprint cancel/accept', 'terminal input/output', 'minimum window', 'restart persistence', 'wrong password', 'known host auto-check', 'changed host key blocked', 'forget trust', 'no test password persisted'], screenshots: artifacts }; require('node:fs').writeFileSync(join(artifacts, 'integration-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close(); if (fixture) await fixture.close();
});

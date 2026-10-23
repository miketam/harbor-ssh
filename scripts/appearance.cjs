const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts', 'appearance'); mkdirSync(artifacts, { recursive: true });
const dataDir = mkdtempSync(join(artifacts, 'profile-'));
const env = { ...process.env, HARBOR_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let app, page, fixture;
const errors = [], measurements = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.HARBOR_APP_EXECUTABLE || require('electron'), args: process.env.HARBOR_APP_EXECUTABLE ? [] : [root], env });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel('主题', { exact: true }).waitFor();
}
async function geometry() {
  return page.evaluate(() => ({ width: innerWidth, height: innerHeight, terminal: document.querySelector('.terminal-stage').getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth, toolbarOverflow: document.querySelector('.terminal-toolbar').scrollWidth > document.querySelector('.terminal-toolbar').clientWidth }));
}
(async () => {
  fixture = await serverFixture(); await launch();
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click();
  for (const [label, value] of [['主机名称', '主题与布局验证'], ['服务器地址', '127.0.0.1'], ['用户名', 'fixture'], ['端口', String(fixture.port)]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '保存主机', exact: true }).click();
  await page.getByRole('button', { name: /^连接主机/ }).click();
  await page.getByLabel('临时密码', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: '开始连接' }).click();
  await page.getByRole('button', { name: '信任并连接', exact: true }).click();
  await page.locator('.terminal-status').getByText('已连接', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('fixture-ready'));
  for (const [width, height] of [[1220,790],[900,790],[1220,600],[900,600]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width,height]);
    await page.waitForTimeout(150);
    const before = await geometry(); const columns = fixture.stats.sizes.at(-1)[0];
    await page.getByRole('button', { name: '收起主机栏', exact: true }).click();
    await page.waitForTimeout(150);
    const after = await geometry();
    assert(after.terminal > before.terminal + 200);
    assert(fixture.stats.sizes.at(-1)[0] > columns, 'SSH PTY must widen');
    assert.equal(await page.locator('#host-sidebar').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: '展开主机栏' }).getAttribute('aria-expanded'), 'false');
    assert(!before.overflow && !after.overflow && !before.toolbarOverflow && !after.toolbarOverflow);
    measurements.push({ before, after });
    if (width === 900 && height === 600) await page.screenshot({ path: join(artifacts, 'collapsed-minimum.png') });
    await page.getByRole('button', { name: '展开主机栏', exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal((await geometry()).terminal, before.terminal);
  }
  const themeIds = await page.getByLabel('主题', { exact: true }).locator('option').evaluateAll(options => options.map(o => o.value));
  assert.equal(themeIds.length, 6);
  for (const id of themeIds) {
    await page.getByLabel('主题', { exact: true }).selectOption(id);
    await page.waitForTimeout(100);
    assert.equal(fixture.stats.connections, 1, 'Appearance must not reconnect SSH');
    assert(await page.locator('.xterm-screen').textContent().then(text => text.includes('fixture-ready')), 'Terminal output must survive');
    const colors = await page.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.terminal-panel')).backgroundColor, terminal: getComputedStyle(document.querySelector('.xterm-scrollable-element')).backgroundColor}));
    assert.equal(colors.panel, colors.terminal, `Theme must reach xterm: ${id}`);
    await page.screenshot({ path: join(artifacts, `${id}-minimum.png`) });
  }
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('appearance-input-check');
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('appearance-input-check'));
  await page.getByRole('button', { name: '收起主机栏' }).click();
  await app.close(); app = null; await launch();
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), 'github-light');
  assert.equal(await page.locator('#host-sidebar').isVisible(), false);
  await page.evaluate(() => localStorage.setItem('harbor.appearance', '{broken'));
  await page.reload(); await page.getByRole('button', { name: '收起主机栏' }).waitFor();
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), 'harbor');
  await page.evaluate(() => localStorage.setItem('harbor.appearance', JSON.stringify({ themeId: 'unknown', sidebarCollapsed: 'yes' })));
  await page.reload(); await page.getByRole('button', { name: '收起主机栏' }).waitFor();
  assert.equal(await page.getByLabel('主题', { exact: true }).inputValue(), 'harbor');
  assert.deepEqual(errors, []);
  const report = { result: 'passed', themes: themeIds, measurements, checks: ['SSH PTY resize', 'input/output and connection preserved', 'six live terminal themes', 'restart preferences', 'invalid preferences fallback', 'four window sizes without overflow'], dataDir };
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); if (fixture) await fixture.close(); });

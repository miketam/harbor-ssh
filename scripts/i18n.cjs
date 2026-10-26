const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts', 'i18n'); mkdirSync(artifacts, { recursive: true });
const dataDir = mkdtempSync(join(artifacts, 'profile-'));
const env = { ...process.env, HARBOR_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let app, page, fixture;
const errors = [], measurements = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.HARBOR_APP_EXECUTABLE || require('electron'), args: process.env.HARBOR_APP_EXECUTABLE ? [] : [root], env });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await require('./ui-helpers.cjs').dismissWelcome(page);
}
async function language(value) {
  // Open settings even when testing a suspended form; its fields must survive.
  await page.locator('.workspace-controls button').last().evaluate(button => button.click());
  await page.locator('.language-picker select').selectOption(value);
  await page.waitForFunction(value => document.documentElement.lang === value, value);
  await page.getByRole('dialog', { name: value === 'en-US' ? 'Settings' : '设置', exact: true }).getByRole('button', { name: value === 'en-US' ? 'Done' : '完成', exact: true }).click();
}
async function englishUI() {
  const chinese = await page.locator('body').evaluate(body => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); const found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('option[value="zh-CN"], .host-text, .tab-strip, .trust-badge, .xterm-screen, .auth-name, .server-text')) continue;
      if (parent.getClientRects().length && /\p{Script=Han}/u.test(node.textContent.replaceAll('测试服务器', ''))) found.push(node.textContent);
    }
    return found;
  });
  assert.deepEqual(chinese, [], 'Application UI should be English');
}
async function closeDialog() { await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click(); }
(async () => {
  fixture = await serverFixture({ allowForward: true }); await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await language('en-US'); await englishUI();
  assert.deepEqual(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label)), ['Harbor SSH', 'Edit', 'Window']);
  await assert.rejects(page.evaluate(() => window.harbor.setLocale('fr')), /Unsupported language/);
  await page.getByRole('button', { name: '＋ Add host', exact: true }).click();
  await englishUI();
  for (const [label, value] of [['Host name', '测试服务器'], ['Server address', 'https://invalid'], ['Username', 'fixture'], ['Port', String(fixture.port)]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save host', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'without a protocol' }).waitFor();
  await language('zh-CN');
  await page.getByRole('alert').filter({ hasText: '服务器地址应为 IP' }).waitFor();
  assert.equal(await page.getByLabel('主机名称', { exact: true }).inputValue(), '测试服务器');
  await language('en-US');
  await page.getByLabel('Server address', { exact: true }).fill('127.0.0.1');
  await page.getByRole('button', { name: 'Save host', exact: true }).click();
  await page.getByRole('button', { name: /Identity vault/ }).click(); await englishUI();
  await page.getByRole('button', { name: 'Add identity', exact: true }).click(); await englishUI();
  await page.getByLabel('Identity authentication method', { exact: true }).selectOption('privateKey'); await englishUI();
  await app.evaluate(({ dialog }) => { globalThis.openTitles = []; dialog.showOpenDialog = async (_window, options) => { globalThis.openTitles.push(options.title); return { canceled: true, filePaths: [] }; }; });
  await page.getByRole('button', { name: 'Import private key from file', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.openTitles), ['Select SSH private key']);
  await closeDialog();
  await page.getByRole('button', { name: /^Connect/ }).click(); await englishUI();
  await page.getByLabel('Temporary password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Start connection', exact: true }).click();
  await page.getByRole('dialog', { name: 'Verify server identity' }).waitFor(); await englishUI();
  await page.getByRole('button', { name: 'Trust and connect', exact: true }).click();
  await page.locator('.terminal-status').getByText('Connected', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('fixture-ready'));
  const terminal = await page.locator('.xterm').elementHandle();
  await language('zh-CN'); await language('en-US');
  assert.equal(fixture.stats.connections, 1);
  assert(await terminal.evaluate(node => node === document.querySelector('.xterm')), 'Terminal must not remount');
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('locale-input-check');
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('locale-input-check'));
  for (const [width, height] of [[1220,790],[900,600]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.waitForTimeout(150);
    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByRole('button', { name: 'Hide hosts', exact: true }).click();
      const geometry = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, toolbarOverflow: document.querySelector('.terminal-toolbar').scrollWidth > document.querySelector('.terminal-toolbar').clientWidth, controlsOverflow: document.querySelector('.workspace-controls').scrollWidth > document.querySelector('.workspace-controls').clientWidth }));
      assert(!geometry.overflow && !geometry.toolbarOverflow && !geometry.controlsOverflow, JSON.stringify(geometry)); measurements.push({ collapsed, ...geometry });
      await page.screenshot({ path: join(artifacts, `english-${width}-${collapsed ? 'collapsed' : 'expanded'}.png`) });
      if (collapsed) await page.getByRole('button', { name: 'Show hosts', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Files & forwarding', exact: true }).click();
  await page.getByRole('alert').waitFor(); await englishUI();
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  assert((await app.evaluate(() => globalThis.openTitles)).includes('Select a file to upload'));
  await page.getByRole('button', { name: 'Local port forwarding', exact: true }).click(); await englishUI();
  await page.getByRole('button', { name: 'Start forwarding', exact: true }).click();
  await page.getByRole('button', { name: 'Stop forwarding', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop forwarding', exact: true }).click(); await closeDialog();
  await page.getByRole('button', { name: /Trusted hosts/ }).click(); await englishUI();
  await page.getByRole('button', { name: 'Remove trust', exact: true }).click(); await englishUI();
  await closeDialog();
  await app.close(); app = null; await launch();
  await page.waitForFunction(() => document.documentElement.lang === 'en-US');
  await page.locator('.workspace-controls').getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.locator('.language-picker select').inputValue(), 'en-US');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByText('Tab restored, ready to connect', { exact: true }).waitFor();
  assert.equal(fixture.stats.connections, 1, 'Restart must not auto-connect');
  await page.evaluate(() => localStorage.setItem('harbor.locale', 'invalid'));
  await page.reload(); await page.locator('.workspace-controls').getByRole('button', { name: '设置', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.deepEqual(errors, []);
  const report = { result: 'passed', measurements, checks: ['English screens and native menu/dialog titles', 'validation errors switch language live', 'form data preserved', 'SSH connection, terminal instance and input/output preserved', 'minimum-window layout', 'port forwarding', 'restart persistence', 'invalid locale fallback'], dataDir };
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); if (fixture) await fixture.close(); });

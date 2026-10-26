const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts', 'clipboard');
mkdirSync(artifacts, { recursive: true });
const env = { ...process.env, HARBOR_DATA_DIR: mkdtempSync(join(artifacts, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
const sql = `SELECT
    TABLE_NAME AS 表名,
    ENGINE AS 引擎,
    TABLE_ROWS AS 估算行数,
    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS 大小MB
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND (ENGINE <> 'InnoDB' OR ENGINE IS NULL)
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC;`;
let app, fixture, savedClipboard;
(async () => {
  fixture = await serverFixture();
  app = await electron.launch({ executablePath: process.env.HARBOR_APP_EXECUTABLE || require('electron'), args: process.env.HARBOR_APP_EXECUTABLE ? [] : [root], env });
  const page = await app.firstWindow(); await require('./ui-helpers.cjs').dismissWelcome(page); page.setDefaultTimeout(12000);
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click();
  for (const [label, value] of [['主机名称', '中文粘贴验证'], ['服务器地址', '127.0.0.1'], ['用户名', 'fixture'], ['端口', String(fixture.port)]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '保存主机', exact: true }).click();
  await page.getByRole('button', { name: /^连接主机/ }).click();
  await page.getByLabel('临时密码', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: '开始连接' }).click();
  await page.getByRole('button', { name: '信任并连接', exact: true }).click();
  await page.locator('.terminal-status').getByText('已连接', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.xterm-screen').textContent.includes('fixture-ready'));
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.__harborClipboardBackup = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  });
  savedClipboard = true;
  for (const method of ['native-paste', 'keyboard-paste']) {
    fixture.stats.input = '';
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), sql);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), sql);
    await page.locator('.xterm-helper-textarea').focus();
    if (method === 'native-paste') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
    else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await assert.doesNotReject(async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && fixture.stats.input.length < sql.length) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(fixture.stats.input, sql.replaceAll('\n', '\r'), `${method}: SSH must receive all Chinese characters`);
    });
    console.log(`${method}: complete SQL received over SSH, including 表名/引擎/估算行数/大小MB`);
  }
  const report = { result: 'passed', executable: process.env.HARBOR_APP_EXECUTABLE || require('electron'), platform: process.platform, checks: ['system clipboard UTF-8 text', 'native paste to terminal to SSH', 'keyboard paste to terminal to SSH'], remote: 'local ssh2 echo fixture; no remote shell or MySQL', runtimeTested: true };
  writeFileSync(join(artifacts, process.env.HARBOR_APP_EXECUTABLE ? 'installed-result.json' : 'source-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) {
    try {
      if (savedClipboard) await app.evaluate(async ({ clipboard }) => { await clipboard.write(globalThis.__harborClipboardBackup); delete globalThis.__harborClipboardBackup; });
    } finally { await app.close(); }
  }
  if (fixture) await fixture.close();
});

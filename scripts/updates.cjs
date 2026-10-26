const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts', 'updates');
mkdirSync(artifacts, { recursive: true });
const dataDir = mkdtempSync(join(artifacts, 'profile-'));
const env = { ...process.env, HARBOR_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;

(async () => {
  const app = await electron.launch({ args: [root], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.locator('.app-shell').waitFor();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('updates:check');
      ipcMain.handle('updates:check', () => ({ currentVersion: '0.4.6', latestVersion: '0.4.7', status: 'available', checkedAt: Date.now() }));
      ipcMain.removeHandler('updates:open');
      ipcMain.handle('updates:open', () => {});
    });
    await page.reload();
    await page.getByRole('button', { name: '跳过，使用经典工作台' }).click();
    await page.getByRole('status').getByText('发现新版本 v0.4.7').waitFor();
    await page.locator('.workspace-controls').getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置' });
    await settings.getByRole('region', { name: '系统更新' }).getByText('发现新版本 v0.4.7').waitFor();
    for (const size of [[1220, 790], [900, 600]]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), size);
      await settings.getByRole('region', { name: '系统更新' }).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await settings.getByRole('button', { name: '检查更新' }).isVisible(), true);
      await page.screenshot({ path: join(artifacts, `settings-${size.join('x')}.png`) });
    }
    await settings.getByRole('button', { name: '检查更新' }).click();
    await settings.getByText('发现新版本 v0.4.7').waitFor();
    await settings.getByRole('button', { name: '完成' }).click();
    await page.getByRole('button', { name: '关闭更新提醒' }).click();
    assert.equal(await page.locator('.update-notice').count(), 0);
    await page.reload();
    assert.equal(await page.locator('.update-notice').count(), 0);
    console.log(JSON.stringify({ result: 'passed', checks: ['startup reminder', 'settings status', 'manual check', 'normal/minimum window', 'dismissal persistence'] }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

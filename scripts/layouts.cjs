const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts', 'layouts'); mkdirSync(artifacts, { recursive: true });
const dataDir = mkdtempSync(join(artifacts, 'profile-'));
const env = { ...process.env, HARBOR_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
let app, page, fixture;
const errors = [];
async function launch() {
  app = await electron.launch(process.env.HARBOR_APP_EXECUTABLE ? { executablePath: process.env.HARBOR_APP_EXECUTABLE, args: [], env } : { args: [root], env });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-shell').waitFor();
}
async function settings() { await page.locator('.workspace-controls').getByRole('button', { name: '设置', exact: true }).click(); await page.locator('.terminal-settings summary').click(); }
async function layout(id) {
  await settings();
  await page.locator('.layout-option').nth(['classic','manager','focus'].indexOf(id)).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('.app-shell').classList.contains('layout-' + id), id);
}
async function output(text) { await page.waitForFunction(text => [...document.querySelectorAll('.xterm-screen')].some(node => node.textContent.includes(text)), text); }
(async () => {
  fixture = await serverFixture(); await launch();
  await page.getByRole('dialog', { name: '选择你的工作区' }).waitFor();
  await page.screenshot({ path: join(artifacts,'welcome.png') });
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click();
  for (const [label,value] of [['主机名称','web-prod'],['服务器地址','127.0.0.1'],['用户名','fixture'],['端口',String(fixture.port)]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'保存主机',exact:true}).click();
  await page.getByRole('button',{name:/^连接主机/}).click();
  await page.getByLabel('临时密码',{exact:true}).fill('fixture-password-only');
  await page.getByRole('button',{name:'开始连接',exact:true}).click();
  await page.getByRole('button',{name:'信任并连接',exact:true}).click();
  await output('fixture-ready');
  // Preserve the actual DOM instances and independently verify a live SSH channel.
  await page.evaluate(() => { window.layoutTerminal = document.querySelector('.xterm'); });
  await page.locator('.terminal-pane:visible .xterm-helper-textarea').focus(); await page.keyboard.type('layout-before-switch');
  await output('layout-before-switch');
  await page.getByRole('button',{name:'新标签',exact:true}).click();
  await page.getByLabel('临时密码',{exact:true}).fill('fixture-password-only');
  await page.getByRole('button',{name:'开始连接',exact:true}).click();
  await page.locator('.terminal-pane:visible .terminal-status').getByText('已连接',{exact:true}).waitFor();
  await page.locator('.terminal-pane:visible .xterm-helper-textarea').focus();
  await page.keyboard.type('second-session-output');
  await output('second-session-output');
  await page.evaluate(() => { window.layoutTerminals = [...document.querySelectorAll('.xterm')]; });
  const session = await page.evaluate(() => window.harbor.getWorkspace());
  for (const size of [[1220,790],[900,600]]) {
    await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size);
    for (const id of ['manager','focus','classic']) {
      await layout(id);
      assert.equal(await page.evaluate(() => window.layoutTerminal === document.querySelector('.xterm')), true, 'Terminal must not remount');
      assert.equal(fixture.stats.connections,2,'Switching must not reconnect');
      await output('layout-before-switch');
      await output('second-session-output');
      assert.equal(await page.evaluate(() => window.layoutTerminals.every((node,i) => node === document.querySelectorAll('.xterm')[i])),true);
      assert.deepEqual((await page.evaluate(() => window.harbor.getWorkspace())).tabs,session.tabs);
      await page.screenshot({path:join(artifacts,id+'-'+size.join('x')+'.png')});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      if (id === 'manager') {
        await page.getByRole('tab',{name:'web-prod',exact:true}).last().click();
        await page.locator('.terminal-pane:visible').waitFor();
      }
      await page.locator('.terminal-pane:visible .xterm-helper-textarea').focus(); await page.keyboard.type('live-'+id);
      await output('live-'+id);
    }
  }
  await layout('focus');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog',{name:'切换主机'}).waitFor();
  await page.getByRole('dialog',{name:'切换主机'}).getByLabel('搜索主机',{exact:true}).fill('no-such-host');
  await page.getByText('没有匹配的主机。',{exact:true}).waitFor();
  await page.getByRole('dialog',{name:'切换主机'}).getByLabel('搜索主机',{exact:true}).fill('web-prod');
  await page.getByRole('dialog',{name:'切换主机'}).getByLabel('搜索主机',{exact:true}).press('Enter');
  assert.equal(fixture.stats.connections,2,'Switcher must reuse connected tab');
  await settings();
  for (const id of ['harbor','one-dark','dracula','nord','solarized-light','github-light']) {
    await page.getByLabel('主题',{exact:true}).selectOption(id);
    await output('layout-before-switch');
    assert.equal(fixture.stats.connections,2);
  }
  await page.getByLabel('语言',{exact:true}).selectOption('en-US');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('.workspace-controls').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('group',{name:'Workspace layout'}).waitFor();
  await page.screenshot({path:join(artifacts,'settings-english.png')});
  await page.getByLabel('Language',{exact:true}).selectOption('zh-CN');
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await app.close(); app = null; await launch();
  assert.equal(await page.getByRole('dialog').count(),0,'Onboarding must not return');
  assert.equal(await page.locator('.layout-focus').count(),1);
  await settings(); assert.equal(await page.getByLabel('主题',{exact:true}).inputValue(),'github-light');
  await page.getByRole('button',{name:'完成',exact:true}).click();
  // Existing preferences migrate without onboarding or losing palette.
  await page.evaluate(() => localStorage.setItem('harbor.appearance',JSON.stringify({themeId:'nord',sidebarCollapsed:true})));
  await page.reload(); await page.locator('.layout-classic').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  await settings(); assert.equal(await page.getByLabel('主题',{exact:true}).inputValue(),'nord');
  await page.getByRole('button',{name:'完成',exact:true}).click();
  // Malformed preferences recover with a usable first-run choice.
  await page.evaluate(() => localStorage.setItem('harbor.appearance','{broken'));
  await page.reload(); await page.getByRole('dialog',{name:'选择你的工作区'}).waitFor();
  await page.getByRole('button',{name:'跳过，使用经典工作台',exact:true}).click();
  assert.equal(await page.locator('.layout-classic').count(),1);
  for (const [id,index] of [['manager',1],['focus',2]]) {
    await page.evaluate(() => localStorage.removeItem('harbor.appearance'));
    await page.reload(); await page.getByRole('dialog',{name:'选择你的工作区'}).waitFor();
    await page.locator('.layout-option').nth(index).click();
    await page.getByRole('button',{name:'开始使用',exact:true}).click();
    assert.equal(await page.locator('.layout-'+id).count(),1);
    assert.equal(await page.locator('#host-sidebar').isVisible(),id !== 'focus');
    await page.reload(); await page.locator('.layout-'+id).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
  }
  assert.deepEqual(errors,[]);
  const report = { result:'passed',dataDir,checks:['first launch and skip','three layouts at normal/minimum size','same xterm DOM instance','SSH connection and live input preserved','terminal output preserved','host switcher reuse','six terminal palettes','English settings','restart persistence','legacy migration','corrupt preference recovery'] };
  writeFileSync(join(artifacts,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
})().catch(error => { console.error(error);process.exitCode=1; }).finally(async () => { if(app) await app.close();if(fixture) await fixture.close(); });

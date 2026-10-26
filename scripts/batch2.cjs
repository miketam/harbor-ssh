const { _electron: electron } = require('playwright');
const { strict: assert } = require('node:assert');
const { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { makeEd25519 } = require('../tests/key-fixture.cjs');
const { serverFixture } = require('../tests/fixture.cjs');
const root = resolve(__dirname, '..'), artifacts = join(root, 'test-artifacts'); mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(join(artifacts, 'batch2-profile-'));
const keys = makeEd25519('batch2-key-passphrase');
const importDir = mkdtempSync(join(tmpdir(), 'harbor-import-')), keyFile = join(importDir, 'fixture_ed25519');
writeFileSync(keyFile, keys.private, { mode: 0o600 });
const env = { ...process.env, HARBOR_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const fixtures = [], errors = [];
const checks = [];
const activePanel = () => page.getByRole('tabpanel');
const status = text => activePanel().locator('.terminal-status').getByText(text, { exact: true });
async function launch() {
  app = await electron.launch({ executablePath: process.env.HARBOR_APP_EXECUTABLE || require('electron'), args: process.env.HARBOR_APP_EXECUTABLE ? [] : [root], env }); page = await app.firstWindow(); await require('./ui-helpers.cjs').dismissWelcome(page); page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message)); await page.getByRole('heading', { level: 1 }).waitFor();
}
async function addHost(name, port, identityName = '', interactive = false) {
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '新增主机' });
  await modal.getByLabel('主机名称', { exact: true }).fill(name); await modal.getByLabel('服务器地址', { exact: true }).fill('127.0.0.1');
  await modal.getByLabel('端口', { exact: true }).fill(String(port));
  if (identityName) { const option = await modal.getByLabel('认证身份', { exact: true }).locator('option').filter({ hasText: identityName }).getAttribute('value'); await modal.getByLabel('认证身份', { exact: true }).selectOption(option); }
  else { await modal.getByLabel('用户名', { exact: true }).fill('fixture'); if (interactive) await modal.getByLabel('认证方式', { exact: true }).selectOption('interactive'); }
  await modal.getByRole('button', { name: '保存主机', exact: true }).click(); await page.getByRole('heading', { name, exact: true }).waitFor();
}
async function openConnect() { await page.getByRole('button', { name: /^连接主机/ }).click(); await page.getByRole('dialog', { name: '连接主机', exact: true }).waitFor(); assert.equal(await page.getByText(/^仅本次替换/).count(), 0); }
async function confirmTrust() { await page.getByRole('button', { name: '信任并连接', exact: true }).click(); }
async function typeInTerminal(text) { await activePanel().locator('.xterm-helper-textarea').focus(); await page.keyboard.type(text); await page.keyboard.press('Enter'); }
async function waitOutput(text) { await page.waitForFunction(text => [...document.querySelectorAll('[role=tabpanel]:not([hidden]) .xterm-screen')].some(node => node.textContent.includes(text)), text); }
function scanSecrets(dir) {
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, file.name); if (file.isDirectory()) { scanSecrets(path); continue; }
    if (['LOCK','SingletonLock','SingletonSocket','SingletonCookie'].includes(file.name)) continue;
    const bytes = readFileSync(path);
    for (const secret of ['fixture-password-only','batch2-key-passphrase','interactive-fixture-password','fixture-device','-----BEGIN OPENSSH PRIVATE KEY-----']) assert.equal(bytes.includes(Buffer.from(secret)), false, `Test secret persisted in ${file.name}`);
  }
}
(async () => {
  const password = await serverFixture(), key = await serverFixture({ auth:'publickey', publicKey:keys.public }), interactive = await serverFixture({auth:'interactive'});
  fixtures.push(password,key,interactive);
  await launch();
  await page.getByRole('button', { name:'加密身份库', exact:true }).click();
  await page.getByRole('button', { name:'新增身份', exact:true }).click();
  await page.getByLabel('身份名称', { exact:true }).fill('密码身份'); await page.getByLabel('身份用户名', { exact:true }).fill('fixture');
  await page.getByLabel('身份密码', { exact:true }).fill('fixture-password-only'); await page.getByRole('button', { name:'保存身份',exact:true }).click();
  await page.getByRole('dialog', { name:'加密身份库',exact:true }).getByText('密码身份', { exact:true }).waitFor({ timeout:45000 });
  assert.equal((await page.evaluate(()=>window.harbor.vaultStatus())).state,'ready');
  const summaries = await page.evaluate(()=>window.harbor.listIdentities());
  assert.equal(summaries.length,1); assert.equal(Object.hasOwn(summaries[0],'password'),false); assert.equal(JSON.stringify(summaries).includes('fixture-password-only'),false);
  checks.push('real safeStorage/Keychain and encrypted password identity');
  await page.screenshot({path:join(artifacts,'batch2-identities.png')});
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await addHost('密码服务器',password.port,'密码身份');
  await openConnect(); assert.equal(await page.getByRole('dialog',{name:'连接主机',exact:true}).locator('input[type=password]').count(),0);
  await page.getByRole('button',{name:'开始连接'}).click(); await confirmTrust(); await status('已连接').waitFor();
  await typeInTerminal('first-tab-only'); await waitOutput('first-tab-only');
  await page.getByRole('button',{name:'新标签',exact:true}).click(); await page.getByRole('button',{name:'开始连接'}).click(); await status('已连接').waitFor();
  await typeInTerminal('second-tab-only'); await waitOutput('second-tab-only');
  assert.equal(await page.getByRole('tab').count(),2);
  await page.getByRole('tab').nth(0).click(); await waitOutput('first-tab-only');
  assert.equal(await activePanel().locator('.xterm-screen').textContent().then(text=>text.includes('second-tab-only')),false);
  await page.getByRole('tab').nth(1).click(); await waitOutput('second-tab-only');
  assert.equal(await activePanel().locator('.xterm-screen').textContent().then(text=>text.includes('first-tab-only')),false);
  checks.push('two concurrent isolated sessions and terminal buffers');
  // Editing a live host applies on next connection; the current endpoint stays visible.
  const firstHost = (await page.evaluate(()=>window.harbor.listHosts()))[0];
  const edited = await page.evaluate(host=>window.harbor.saveHost({...host,address:'localhost'}),firstHost);assert.equal(edited.address,'localhost');
  assert.ok((await activePanel().locator('.session-endpoint').textContent()).includes('127.0.0.1'));
  await page.evaluate(host=>window.harbor.saveHost(host),firstHost);
  await page.getByRole('tab').nth(0).click();await page.getByRole('button',{name:/断开连接/}).click();await status('已断开').waitFor();
  await page.getByRole('tab').nth(1).click();await page.getByRole('button',{name:/断开连接/}).click();await status('已断开').waitFor();
  // Editing a summary must preserve the existing secret without returning it to the renderer.
  await page.getByRole('button',{name:'加密身份库',exact:true}).click();
  await page.getByRole('dialog',{name:'加密身份库'}).getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'编辑身份'}).locator('input[type=password]').count(),0);
  await page.getByLabel('身份名称',{exact:true}).fill('密码身份已编辑'); await page.getByRole('button',{name:'保存身份',exact:true}).click();
  await page.getByText('密码身份已编辑',{exact:true}).waitFor();
  await page.getByRole('button',{name:'新增身份',exact:true}).click();
  await page.getByLabel('身份名称',{exact:true}).fill('私钥身份');await page.getByLabel('身份用户名',{exact:true}).fill('fixture');await page.getByLabel('身份认证方式',{exact:true}).selectOption('privateKey');
  await app.evaluate(({dialog}, file) => { dialog.showOpenDialog = async()=>({canceled:false,filePaths:[file]}); },keyFile);
  await page.getByRole('button',{name:'从文件导入私钥',exact:true}).click(); await page.getByText(/已选择：fixture_ed25519/).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'新增身份'}).locator('textarea').count(),0);
  await page.getByRole('button',{name:'保存身份',exact:true}).click();await page.getByText('私钥身份',{exact:true}).waitFor();unlinkSync(keyFile);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await addHost('私钥服务器',key.port,'私钥身份');
  await openConnect();await page.getByLabel('私钥 passphrase',{exact:true}).fill('wrong-fixture-passphrase');await page.getByRole('button',{name:'开始连接'}).click();
  await page.getByRole('dialog',{name:'连接主机'}).getByRole('alert').filter({hasText:'私钥格式'}).waitFor();assert.equal(key.stats.authenticated,0);
  await page.getByLabel('私钥 passphrase',{exact:true}).fill('batch2-key-passphrase');await page.getByRole('button',{name:'开始连接'}).click();await confirmTrust();await status('已连接').waitFor();
  await typeInTerminal('key-tab-only');await waitOutput('key-tab-only');checks.push('private key token import, temporary passphrase, wrong passphrase rejection, Ed25519 authentication');
  await addHost('交互服务器',interactive.port,'',true);await openConnect();await page.getByRole('button',{name:'开始连接'}).click();await confirmTrust();
  await page.getByRole('dialog',{name:'交互认证'}).waitFor();await page.getByLabel('Test password: ',{exact:true}).fill('interactive-fixture-password');await page.getByRole('button',{name:'提交回答',exact:true}).click();
  await page.getByLabel('Verification code: ',{exact:true}).waitFor();assert.equal(await page.getByLabel('Verification code: ',{exact:true}).getAttribute('type'),'password');assert.equal(await page.getByLabel('Device label: ',{exact:true}).getAttribute('type'),'text');
  await page.getByLabel('Verification code: ',{exact:true}).fill('246810');await page.getByLabel('Device label: ',{exact:true}).fill('fixture-device');await page.getByRole('button',{name:'提交回答',exact:true}).click();await status('已连接').waitFor();
  await typeInTerminal('interactive-tab-only');await waitOutput('interactive-tab-only');checks.push('multi-round keyboard-interactive with multiple prompts and echo flags');
  await page.screenshot({path:join(artifacts,'batch2-tabs.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,600));await page.waitForTimeout(150);
  const bounds=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight}));assert.ok(bounds.sw<=bounds.w&&bounds.sh<=bounds.h);await page.screenshot({path:join(artifacts,'batch2-minimum.png')});
  const workspace=await page.evaluate(()=>window.harbor.getWorkspace());assert.equal(workspace.tabs.length,4);
  const connections=fixtures.map(f=>f.stats.connections);await app.close();app=undefined;
  scanSecrets(profile);
  await launch();await page.getByRole('tab').nth(3).waitFor();
  assert.equal(await page.getByRole('tab').count(),4);assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),`tab-${workspace.activeTabId}`);
  await page.waitForTimeout(250);assert.deepEqual(fixtures.map(f=>f.stats.connections),connections);await status('未连接').waitFor();checks.push('restart restores tab order/active tab, never auto-connects or persists output');
  await page.getByRole('tab').nth(0).click();await openConnect();await page.getByRole('button',{name:'开始连接'}).click();await status('已连接').waitFor();checks.push('saved password identity and host trust usable after restart');
  // Close one active tab with confirmation; other restored tabs remain.
  await page.getByRole('button',{name:'关闭标签 密码服务器',exact:true}).nth(0).click();await page.getByRole('button',{name:'断开并关闭',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=tab]').length===3);
  await app.close();app=undefined;
  // Remove only this synthetic profile's wrapped key. It must not regenerate a new key over existing identities.
  const keyPath=join(profile,'vault-key.bin'),keyBackup=join(profile,'vault-key.test-backup');renameSync(keyPath,keyBackup);
  await launch();await page.getByRole('button',{name:'加密身份库',exact:true}).click();await page.getByText(/身份库密钥文件缺失/).waitFor();assert.equal(existsSync(keyPath),false);
  assert.equal(await page.getByRole('button',{name:'新增身份',exact:true}).isDisabled(),true);
  renameSync(keyBackup,keyPath);await page.getByRole('button',{name:'重试解锁身份库',exact:true}).click();await page.getByText('密码身份已编辑',{exact:true}).waitFor();checks.push('missing wrapped key fails closed, recovery uses original key');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  assert.deepEqual(errors,[]);await app.close();app=undefined;scanSecrets(profile);
  const report={result:'passed',profile,checks,counts:{identities:2,tabsBeforeRestart:4,tabsAfterClose:3},screenshots:['batch2-identities.png','batch2-tabs.png','batch2-minimum.png']};writeFileSync(join(artifacts,'batch2-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(async error=>{console.error(error); if(page&&!page.isClosed()){await page.screenshot({path:join(artifacts,'batch2-failure.png')});console.error(JSON.stringify({safeUiErrors:await page.locator('.form-error,.session-error,.error-banner').allTextContents()}));}process.exitCode=1;}).finally(async()=>{if(app)await app.close();for(const fixture of fixtures)await fixture.close();if(existsSync(keyFile))unlinkSync(keyFile);});

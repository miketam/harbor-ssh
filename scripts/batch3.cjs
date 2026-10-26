const { _electron: electron } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, openSync, closeSync, ftruncateSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { utils } = require('ssh2');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..'), artifacts = join(root, 'test-artifacts'); mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(join(artifacts, 'batch3-profile-')), local = mkdtempSync(join(artifacts, 'batch3-files-'));
const container = `harbor-daily-${process.pid}`;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'batch3-key-test-only' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
// Export public SSH wire format independently from the encrypted PKCS8 import path.
const rsaPem = require('node:crypto').createPrivateKey({ key: keys.privateKey, passphrase: 'batch3-key-test-only' }).export({ type: 'pkcs1', format: 'pem' });
const authorized = utils.parseKey(rsaPem); assert.ok(!(authorized instanceof Error));
const publicLine = 'ssh-rsa ' + authorized.getPublicSSH().toString('base64') + ' harbor-batch3-test-only\n';
const uploadFile = join(local, '中文 upload.txt'), downloadFile = join(local, 'download.txt'); writeFileSync(uploadFile, 'Harbor SFTP 中文\n'.repeat(5000));
const cancelFile = join(local, 'cancel-upload.bin'); let fd = openSync(cancelFile, 'w'); ftruncateSync(fd, 512 * 1024 * 1024); closeSync(fd);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, stdio: ['pipe','pipe','pipe'], timeout: 120000 }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, page, created = false; const checks = [], uiErrors = [];
const env = { ...process.env, HARBOR_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
async function launch() { app = await electron.launch(process.env.HARBOR_APP_EXECUTABLE ? { executablePath: process.env.HARBOR_APP_EXECUTABLE, args: [], env } : { executablePath: require('electron'), args: [root], env }); page = await app.firstWindow(); await require('./ui-helpers.cjs').dismissWelcome(page); page.setDefaultTimeout(20000); page.on('pageerror', e => uiErrors.push(e.message)); await page.getByRole('heading', { level: 1 }).waitFor(); assert.equal(await app.evaluate(({app})=>app.commandLine.hasSwitch('use-mock-keychain')), false); await page.evaluate(() => { window.testTransfers = []; window.harbor.onSession(e => { if (e.type === 'transfer') window.testTransfers.push(e.transfer); }); }); }
const panel = () => page.getByRole('tabpanel');
async function connected() { await panel().locator('.terminal-status').getByText('已连接', { exact: true }).waitFor(); }
async function begin(name, password, remember = false) {
  await page.getByRole('button', { name: new RegExp(name + '.*@') }).click();
  await page.getByRole('button', { name: /^连接主机/ }).click();
  const modal = page.getByRole('dialog', { name: '连接主机', exact: true });
  if (password) await modal.getByLabel('临时密码', { exact: true }).fill(password);
  else assert.equal(await modal.locator('input[type=password]').count(), 0);
  if (remember) await modal.getByLabel('保存密码，下次连接复用').check();
  await modal.getByRole('button', { name: remember ? '保存并连接' : '开始连接', exact: true }).click();
}
async function activeSession() { return page.evaluate(async () => { const state = await window.harbor.getWorkspace(); return window.testSessionIds?.[state.activeTabId]; }); }
async function collectSessionIds() { await page.evaluate(() => { window.testSessionIds = {}; window.harbor.onSession(e => { if (e.type === 'status') window.testSessionIds[e.tabId] = e.sessionId; }); }); }
async function trust() { await page.getByRole('button', { name: '信任并连接', exact: true }).click(); }
async function tools() { await panel().getByRole('button', { name: '文件与转发', exact: true }).click(); return page.getByRole('dialog', { name: /^文件与转发/ }); }
async function nativeOpen(path) { await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, path); }
async function nativeSave(path) { await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, path); }
function scan(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) scan(path); else if (!['LOCK','SingletonLock','SingletonCookie','SingletonSocket'].includes(entry.name)) { const bytes = readFileSync(path); for (const secret of ['fixture-password-only', 'batch3-key-test-only', keys.privateKey, '-----BEGIN ENCRYPTED PRIVATE KEY-----']) assert.equal(bytes.includes(Buffer.from(secret)), false, 'test secret persisted in plaintext'); } } }
(async () => {
  docker(['run', '-d', '--rm', '--name', container, '-p', '127.0.0.1::22', 'alpine:3.23', 'sh', '-c', "apk add --no-cache openssh-server busybox-extras >/dev/null && ssh-keygen -A >/dev/null 2>&1 && adduser -D -s /bin/sh fixture && echo fixture:fixture-password-only | chpasswd && mkdir -p /home/fixture/files /home/fixture/.ssh && echo HTTP_FORWARD_OK > /home/fixture/health.txt && echo KEEP_EXISTING > '/home/fixture/files/existing.txt' && ln -s existing.txt /home/fixture/files/link.txt && truncate -s 536870912 /home/fixture/files/cancel-download.bin && chown -R fixture:fixture /home/fixture && httpd -p 8080 -h /home/fixture && exec /usr/sbin/sshd -D -e -f /dev/null -h /etc/ssh/ssh_host_ed25519_key -o 'Subsystem=sftp internal-sftp' -o PasswordAuthentication=yes -o AllowTcpForwarding=yes -o PermitRootLogin=no"]); created = true;
  let ready = false; for (let i = 0; i < 90; i++) { try { docker(['exec', container, 'pgrep', '-f', '^sshd.*: /usr/sbin/sshd']); ready = true; break; } catch { await pause(1000); } } assert.ok(ready, 'OpenSSH did not start');
  docker(['exec', '-i', container, 'sh', '-c', 'cat > /home/fixture/.ssh/authorized_keys && chown fixture:fixture /home/fixture/.ssh/authorized_keys && chmod 700 /home/fixture/.ssh && chmod 600 /home/fixture/.ssh/authorized_keys'], publicLine);
  const port = Number(docker(['port', container, '22/tcp']).split(':').pop());
  await launch();
  await page.evaluate(async port => { await window.harbor.saveHost({ name: '跳板测试机', address: '127.0.0.1', port, username: 'fixture', group: 'Batch 3' }); }, port);
  await page.reload(); await page.getByRole('heading', { level: 1 }).waitFor(); await collectSessionIds();
  await begin('跳板测试机', 'fixture-password-only', true); await trust(); await connected();
  assert.equal((await page.evaluate(() => window.harbor.listIdentities())).length, 1);
  checks.push('connection dialog remembers password in real Keychain-protected identity and binds host');
  await app.close(); app = undefined; await launch(); await collectSessionIds();
  await begin('跳板测试机'); await connected(); checks.push('restart password reuse without any password input');
  await page.getByRole('button', { name: /^断开连接/ }).click();
  // UI file import exercises PKCS8 save with the real system key provider.
  const importFile = join(local, 'rsa-pkcs8.pem'); writeFileSync(importFile, keys.privateKey, { mode: 0o600 }); await nativeOpen(importFile);
  await page.getByRole('button', { name: /加密身份库/ }).click(); await page.getByRole('button', { name: '新增身份', exact: true }).click();
  const identity = page.getByRole('dialog', { name: '新增身份', exact: true });
  await identity.getByLabel('身份名称', { exact: true }).fill('PKCS8 复用身份'); await identity.getByLabel('身份用户名', { exact: true }).fill('fixture'); await identity.getByLabel('身份认证方式', { exact: true }).selectOption('privateKey');
  await identity.getByRole('button', { name: '从文件导入私钥', exact: true }).click(); await identity.getByText(/已选择：rsa-pkcs8.pem/).waitFor(); await identity.getByLabel('私钥 passphrase', { exact: true }).fill('batch3-key-test-only'); await identity.getByRole('button', { name: '保存身份', exact: true }).click();
  await page.getByText('PKCS8 复用身份', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '＋ 新增主机', exact: true }).click(); const host = page.getByRole('dialog', { name: '新增主机', exact: true });
  await host.getByLabel('主机名称', { exact: true }).fill('经跳板的目标'); await host.getByLabel('服务器地址', { exact: true }).fill('localhost'); await host.getByLabel('认证身份', { exact: true }).selectOption({ label: 'PKCS8 复用身份 · fixture' }); await host.getByLabel('跳板机', { exact: true }).selectOption({ label: `跳板测试机 · 127.0.0.1` }); await host.getByRole('button', { name: '保存主机', exact: true }).click();
  await page.evaluate(port => window.harbor.forgetKnownHost('127.0.0.1', port), port);
  await collectSessionIds(); await begin('经跳板的目标');
  await page.getByRole('dialog', { name: '确认服务器身份', exact: true }).getByText('跳板测试机', { exact: true }).waitFor(); await trust();
  await page.getByRole('dialog', { name: '确认服务器身份', exact: true }).getByText('经跳板的目标', { exact: true }).waitFor(); await trust();
  await connected(); const sessionId = await activeSession(); assert.ok(sessionId);
  await panel().locator('.xterm-helper-textarea').focus(); await page.keyboard.type('printf "\\112\\125\\115\\120\\137\\117\\113\\n"'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('[role=tabpanel]:not([hidden]) .xterm-screen')?.textContent.includes('JUMP_OK'));
  const trustRows = await page.evaluate(() => window.harbor.listKnownHosts()); assert.equal(trustRows.length, 2); assert.ok(trustRows.some(row => row.port === 22)); checks.push('single-hop real OpenSSH target with PKCS8 key; separate jump and target trust records');
  let modal = await tools(); await modal.getByLabel('远程目录', { exact: true }).fill('/home/fixture/files'); await modal.getByRole('button', { name: '打开目录', exact: true }).click(); await modal.getByRole('button', { name: '下载 existing.txt', exact: true }).waitFor();
  assert.equal(await modal.getByRole('button', { name: '下载 link.txt', exact: true }).isDisabled(), true);
  await nativeOpen(uploadFile); await modal.getByRole('button', { name: '上传文件', exact: true }).click(); await modal.getByRole('button', { name: '下载 中文 upload.txt', exact: true }).waitFor();
  assert.equal(digest(Buffer.from(docker(['exec', container, 'cat', '/home/fixture/files/中文 upload.txt'])+'\n')), digest(readFileSync(uploadFile)));
  await nativeSave(downloadFile); await modal.getByRole('button', { name: '下载 中文 upload.txt', exact: true }).click(); await page.waitForFunction(() => window.testTransfers.some(t => t.direction === 'download' && t.state === 'completed')); assert.equal(digest(readFileSync(downloadFile)), digest(readFileSync(uploadFile)));
  await modal.getByRole('button', { name: '上传文件', exact: true }).click(); await modal.getByText('上传失败，请检查权限；同名文件不会覆盖。', { exact: true }).waitFor(); assert.equal(digest(Buffer.from(docker(['exec', container, 'cat', '/home/fixture/files/中文 upload.txt'])+'\n')), digest(readFileSync(uploadFile)));
  checks.push('SFTP Unicode upload/download SHA256 equality, existing-file protection and symlink download disabled');
  await nativeOpen(cancelFile); await modal.getByRole('button', { name: '上传文件', exact: true }).click(); await modal.getByRole('button', { name: '取消传输', exact: true }).click(); await page.waitForFunction(() => window.testTransfers.some(t => t.name === 'cancel-upload.bin' && t.state === 'cancelled')); docker(['exec', container, 'test', '!', '-e', '/home/fixture/files/cancel-upload.bin']);
  const cancelledDownload = join(local, 'cancelled-download.bin'); await nativeSave(cancelledDownload); await modal.getByRole('button', { name: '下载 cancel-download.bin', exact: true }).click(); await modal.getByRole('button', { name: '取消传输', exact: true }).click(); await page.waitForFunction(() => window.testTransfers.some(t => t.name === 'cancel-download.bin' && t.state === 'cancelled')); assert.equal(existsSync(cancelledDownload), false); assert.equal(readdirSync(local).some(name => name.endsWith('.part')), false);
  await modal.locator('.transfer-row').filter({ hasText: 'cancel-download.bin' }).locator('small').filter({ hasText: '已取消' }).waitFor();
  checks.push('cancel upload cleans remote partial; cancel download preserves local destination and cleans temporary file');
  await modal.evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: join(artifacts, 'batch3-sftp.png') });
  await modal.getByRole('button', { name: '本地端口转发', exact: true }).click(); await modal.getByLabel('远程目标端口', { exact: true }).fill('8080'); await modal.getByRole('button', { name: '启动转发', exact: true }).click(); await modal.getByRole('button', { name: '停止转发', exact: true }).waitFor();
  let forwards = await page.evaluate(id => window.harbor.listForwards(id), sessionId); assert.equal(forwards.length, 1); const localPort = forwards[0].localPort;
  assert.equal((await fetch(`http://127.0.0.1:${localPort}/health.txt`)).status, 200); assert.equal(await (await fetch(`http://127.0.0.1:${localPort}/health.txt`)).text(), 'HTTP_FORWARD_OK\n');
  // Port conflicts fail without changing the existing forward.
  await modal.getByLabel('本地端口', { exact: true }).fill(String(localPort)); await modal.getByRole('button', { name: '启动转发', exact: true }).click(); await modal.locator('.form-error').waitFor(); assert.equal((await page.evaluate(id => window.harbor.listForwards(id), sessionId)).length, 1);
  await page.screenshot({ path: join(artifacts, 'batch3-forward.png') });
  await app.evaluate(async({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900,600); }); assert.equal(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().bottom <= innerHeight), true); await page.screenshot({ path: join(artifacts, 'batch3-minimum.png') });
  await modal.getByRole('button', { name: '停止转发', exact: true }).click(); await assert.rejects(fetch(`http://127.0.0.1:${localPort}/health.txt`));
  await modal.getByLabel('本地端口', { exact: true }).fill('0'); await modal.getByRole('button', { name: '启动转发', exact: true }).click(); await modal.getByRole('button', { name: '停止转发', exact: true }).waitFor(); forwards = await page.evaluate(id => window.harbor.listForwards(id), sessionId); const closePort = forwards[0].localPort;
  await modal.getByRole('button', { name: 'SFTP 文件', exact: true }).click(); await nativeOpen(cancelFile);
  await modal.getByRole('button', { name: '上传文件', exact: true }).click(); await modal.getByRole('button', { name: '取消传输', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: /^断开连接/ }).click(); await pause(700);
  docker(['exec', container, 'test', '!', '-e', '/home/fixture/files/cancel-upload.bin']); await assert.rejects(fetch(`http://127.0.0.1:${closePort}/health.txt`));
  checks.push('loopback forward HTTP request, occupied port rejection, manual stop and session-close cleanup of sockets and active upload');
  await app.close(); app = undefined; await launch(); await collectSessionIds();
  await begin('经跳板的目标'); await connected(); const newSession = await activeSession(); assert.equal((await page.evaluate(id => window.harbor.listForwards(id), newSession)).length, 0);
  checks.push('saved PKCS8 private key and passphrase reuse after restart through saved jump; forwards never auto-restore');
  modal = await tools(); await modal.getByLabel('远程目录', { exact: true }).fill('/home/fixture/files'); await modal.getByRole('button', { name: '打开目录', exact: true }).click(); await modal.getByRole('button', { name: '下载 existing.txt', exact: true }).waitFor();
  const concurrency = await page.evaluate(async port => {
    const host = await window.harbor.saveHost({ name: '并发连接边界', address: '127.0.0.1', port, username: 'fixture', group: 'Batch 3' });
    const results = await Promise.allSettled([0,1].map(() => window.harbor.connect({ tabId: 'concurrent-test', hostId: host.id, password: 'fixture-password-only', remember: true, columns: 80, rows: 24 })));
    for (const result of results) if (result.status === 'fulfilled') await window.harbor.disconnect(result.value);
    return results.map(result => result.status);
  }, port);
  assert.equal(concurrency.filter(status => status === 'fulfilled').length, 1); checks.push('concurrent remember-and-connect requests cannot open duplicate workers for one tab');
  await nativeOpen(cancelFile); await modal.getByRole('button', { name: '上传文件', exact: true }).click(); await modal.getByRole('button', { name: '取消传输', exact: true }).waitFor();
  await app.close(); app = undefined; docker(['exec', container, 'test', '!', '-e', '/home/fixture/files/cancel-upload.bin']);
  checks.push('normal application quit drains active upload and cleans remote partial');
  assert.deepEqual(uiErrors, []); if (app) { await app.close(); app = undefined; } scan(profile);
  const report = { result: 'passed', profile, nativeKeychain: true, executable: process.env.HARBOR_APP_EXECUTABLE || require('electron'), checks, screenshots: ['batch3-sftp.png','batch3-forward.png','batch3-minimum.png'], plaintextTestCredentialsFound: false }; writeFileSync(join(artifacts,'batch3-result.json'), JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
})().catch(async error => { if (page) try { await page.screenshot({ path: join(artifacts,'batch3-failure.png') }); console.error('UI errors:', await page.locator('.form-error,.session-error,.error-banner').allTextContents()); } catch {} console.error(error.message); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); if (created) docker(['rm','-f',container]); });

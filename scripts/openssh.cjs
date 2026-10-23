const { _electron: electron } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const artifacts = join(root, 'test-artifacts'); mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(join(artifacts, 'openssh-profile-'));
const name = `harbor-openssh-${process.pid}`;
function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim(); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app; let created = false;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (!['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK'].includes(entry.name)) assert.equal(readFileSync(file).includes(Buffer.from('fixture-password-only')), false);
  }
}
(async () => {
  docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::22', 'alpine:3.23', 'sh', '-c', 'apk add --no-cache openssh >/dev/null && ssh-keygen -A >/dev/null 2>&1 && adduser -D -s /bin/sh fixture && echo fixture:fixture-password-only | chpasswd && exec /usr/sbin/sshd -D -e -o PasswordAuthentication=yes -o KbdInteractiveAuthentication=no -o PermitRootLogin=no -o PrintMotd=no']);
  created = true;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { docker(['exec', name, 'pgrep', '-f', 'sshd: /usr/sbin/sshd']); ready = true; break; } catch { await pause(1000); }
  }
  assert.ok(ready, 'OpenSSH did not start');
  const port = Number(docker(['port', name, '22/tcp']).split(':').pop());
  const env = { ...process.env, HARBOR_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '终端，准备就绪。' }).waitFor();
  const saved = await page.evaluate(async port => window.harbor.saveHost({ name: 'OpenSSH 实机验证', address: '127.0.0.1', port, username: 'fixture', group: '本地容器' }), port);
  // Reload uses the same persisted host through the normal app startup path.
  await page.reload(); await page.getByRole('heading', { name: saved.name, exact: true }).waitFor();
  await page.getByRole('button', { name: /^连接主机/ }).click();
  await page.getByLabel('临时密码', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: '开始连接' }).click();
  await page.getByRole('dialog', { name: '确认服务器身份' }).waitFor();
  await page.getByRole('button', { name: '信任并连接' }).click();
  await page.locator('.terminal-status').getByText('已连接', { exact: true }).waitFor();
  await page.locator('.xterm-helper-textarea').focus();
  // Actual /bin/sh execution inside OpenSSH, not the protocol fixture's echo handler.
  await page.keyboard.type('printf "\\110\\101\\122\\102\\117\\122\\137\\117\\120\\105\\116\\123\\123\\110\\137\\117\\113\\n"; tty; stty size'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-screen')?.textContent?.includes('HARBOR_OPENSSH_OK'));
  await page.waitForFunction(() => /\/dev\/pts\/\d/.test(document.querySelector('.xterm-screen')?.textContent || ''));
  await page.screenshot({ path: join(artifacts, '05-openssh.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600)); await pause(200);
  await page.keyboard.type('stty size'); await page.keyboard.press('Enter'); await pause(150);
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(dimensions.scrollHeight <= dimensions.height && dimensions.scrollWidth <= dimensions.width);
  await page.screenshot({ path: join(artifacts, '06-openssh-minimum.png') });
  // Multibyte UTF-8 and ANSI screen behavior through the real PTY.
  await page.keyboard.type('printf "\\344\\270\\255\\346\\226\\207\\n"'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-screen')?.textContent?.includes('中文'));
  await page.keyboard.type('exit'); await page.keyboard.press('Enter');
  await page.locator('.terminal-status').getByText('已断开', { exact: true }).waitFor();
  await app.close(); app = undefined;
  scan(profile);
  const report = { result: 'passed', image: 'alpine:3.23', sshVersion: docker(['exec', name, 'sh', '-c', '/usr/sbin/sshd -V 2>&1']), checks: ['Electron to OpenSSH password login', 'host-key confirmation', 'real remote shell execution', 'PTY allocation', 'window resize', 'UTF-8 output', 'remote exit', 'no test password persisted', 'minimum window without overflow'], profile };
  writeFileSync(join(artifacts, 'openssh-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close(); if (created) docker(['rm', '-f', name]);
});

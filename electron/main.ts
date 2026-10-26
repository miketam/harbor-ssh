import { translate, type Locale } from '../locales';
import { app, BrowserWindow, ipcMain, Menu, utilityProcess, safeStorage, dialog, type UtilityProcess } from 'electron';
import { mkdirSync, chmodSync, openSync, readSync, closeSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve, dirname, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Vault } from './vault';
import { forwardInput, remotePath } from './resources';
import { Identities } from './identities';
import type { AuthCredentials, ConnectRequest, Host, SessionEvent, SshEvent, ResourceRequest, JumpConnection } from '../shared';

let locale: Locale = 'zh-CN';
const t = (message: string) => translate(message, locale);
let window: BrowserWindow | undefined;
let store: Store;
let vault: Vault;
let identities: Identities;
let rendererVersion = 0;
interface RunningSession {
  id: string; tabId: string; host: Host; worker: UtilityProcess;
  jumpHost?: Host; connected: boolean; exited?: boolean;
  pending: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  transfers: Map<string, { temp?: string; destination?: string }>;
  pendingFingerprint?: { value: string; host: Host }; challenge?: { requestId: string; count: number };
}
const sessions = new Map<string, RunningSession>();
const closingWorkers = new Set<UtilityProcess>();
const keyImports = new Map<string, { value: string; expires: number }>();
const indexPath = join(__dirname, '../../dist/index.html');
const indexURL = pathToFileURL(indexPath).href;
// Preserve the existing profile path independently of packaged bootstrap metadata.
app.setName('Harbor SSH');
app.setPath('userData', process.env.HARBOR_DATA_DIR ? resolve(process.env.HARBOR_DATA_DIR) : join(app.getPath('appData'), 'Harbor SSH'));
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on('second-instance', () => { window?.show(); window?.focus(); });

function notify(event: SessionEvent): void { if (window && !window.isDestroyed()) window.webContents.send('session:event', event); }
function removePartial(path: string): boolean { try { rmSync(path, { force: true }); return true; } catch { return false; } }
function closeSession(id: string): void {
  const current = sessions.get(id);
  if (!current) return;
  sessions.delete(id);
  for (const pending of current.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('会话已结束')); }
  for (const item of current.transfers.values()) if (item.temp && !removePartial(item.temp)) notify({ type: 'error', sessionId: id, tabId: current.tabId, message: '下载已停止，但无法清理本地临时文件，请检查下载目录权限。' });
  if (!current.exited) {
    closingWorkers.add(current.worker);
    try { current.worker.postMessage({ type: 'close' }); } catch { /* An exited worker owns no remaining sockets. */ }
    const timer = setTimeout(() => current.worker.kill(), 4000); timer.unref();
    current.worker.once('exit', () => { clearTimeout(timer); closingWorkers.delete(current.worker); });
  }
  notify({ type: 'status', sessionId: id, tabId: current.tabId, state: 'disconnected', host: current.host });
}
function closeAll(): void { rendererVersion++; for (const id of sessions.keys()) closeSession(id); }
function owned(id: unknown): RunningSession | undefined { return typeof id === 'string' ? sessions.get(id) : undefined; }
function trustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === indexURL;
}
function dimensions(columns: unknown, rows: unknown): { columns: number; rows: number } {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || Number(columns) < 2 || Number(columns) > 500 || Number(rows) < 1 || Number(rows) > 200) throw new Error('终端尺寸无效');
  return { columns: Number(columns), rows: Number(rows) };
}
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error('请求来源不受信任');
    return fn(...args);
  });
}
function activeHost(id: string): boolean { return [...sessions.values()].some(session => session.host.id === id || session.jumpHost?.id === id); }
function connected(id: unknown): RunningSession {
  const current = owned(id); if (!current?.connected) throw new Error('请先连接终端'); return current;
}
function rpc(current: RunningSession, request: ResourceRequest): Promise<any> {
  if (current.pending.size >= 16) return Promise.reject(new Error('操作过于频繁，请等待当前操作完成'));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { current.pending.delete(requestId); reject(new Error('操作超时，请断开后重试')); closeSession(current.id); }, 30000);
    current.pending.set(requestId, { resolve, reject, timer });
    current.worker.postMessage({ type: 'resource', requestId, request });
  });
}
function setupIPC(): void {
  handle('settings:locale', value => {
    if (value !== 'zh-CN' && value !== 'en-US') throw new Error('Unsupported language');
    locale = value;
    updateMenu();
  });
  handle('hosts:list', () => store.listHosts());
  handle('hosts:save', input => {
    return store.saveHost(input);
  });
  handle('hosts:delete', id => {
    if (activeHost(id)) throw new Error('请先断开此主机的所有会话再删除');
    store.deleteHost(id);
  });
  handle('trust:list', () => store.listKnownHosts());
  handle('trust:forget', (address, port) => {
    if ([...sessions.values()].some(session => (session.host.address === address && session.host.port === port) || (session.jumpHost?.address === address && session.jumpHost?.port === port))) throw new Error('请先断开此主机的所有会话再移除信任');
    store.forget(address, port);
  });
  handle('vault:status', () => vault.status());
  handle('vault:unlock', async () => { try { await vault.open(); } catch { /* Surface the safe status, never native errors. */ } return vault.status(); });
  handle('identities:list', () => identities.list());
  handle('identities:save', async input => {
    if (input?.id && [...sessions.values()].some(session => (session.host.identityId === input.id || session.jumpHost?.identityId === input.id))) throw new Error('请先断开使用此身份的所有会话再编辑身份');
    // Imported key bytes stay in the main process; the renderer receives a short-lived token only.
    if (input?.privateKey?.action === 'import') {
      const entry = keyImports.get(input.privateKey.token);
      if (!entry || entry.expires < Date.now()) throw new Error('导入的私钥已过期，请重新选择文件');
      const value = entry.value;
      const result = await identities.save({ ...input, privateKey: { action: 'replace', value } });
      keyImports.delete(input.privateKey.token);
      return result;
    }
    return identities.save(input);
  });
  handle('identities:delete', id => store.deleteIdentity(id));
  handle('identities:import', async () => {
    if (!window) return null;
    const chosen = await dialog.showOpenDialog(window, { title: t('选择 SSH 私钥'), properties: ['openFile'] });
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    let fd: number | undefined;
    let value: string;
    try {
      fd = openSync(chosen.filePaths[0], 'r');
      const data = Buffer.alloc(65537);
      const size = readSync(fd, data, 0, data.length, 0);
      if (!size || size > 65536) throw new Error();
      value = data.subarray(0, size).toString('utf8'); data.fill(0);
    } catch { throw new Error('无法读取私钥，请选择不超过 64 KiB 的文本私钥文件'); }
    finally { if (fd !== undefined) closeSync(fd); }
    for (const [token, entry] of keyImports) if (entry.expires < Date.now()) keyImports.delete(token);
    if (keyImports.size >= 10) keyImports.delete(keyImports.keys().next().value!);
    const token = randomUUID(); keyImports.set(token, { value, expires: Date.now() + 5 * 60_000 });
    setTimeout(() => keyImports.delete(token), 5 * 60_000).unref();
    return { token, fileName: basename(chosen.filePaths[0]) };
  });
  handle('workspace:get', () => store.getWorkspace());
  handle('workspace:save', input => store.saveWorkspace(input));
  handle('session:connect', async (input: unknown) => {
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['tabId','hostId','password','passphrase','jumpPassword','jumpPassphrase','remember','columns','rows'].includes(k))) throw new Error('连接请求格式无效');
    const request = input as ConnectRequest;
    if (request.remember !== undefined && typeof request.remember !== 'boolean') throw new Error('保存选项无效');
    if (typeof request.tabId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(request.tabId)) throw new Error('终端标签无效');
    const size = dimensions(request.columns, request.rows);
    const host = store.getHost(request.hostId);
    if ([...sessions.values()].some(session => session.tabId === request.tabId)) throw new Error('此标签已有连接，请先断开');
    if (sessions.size >= 10) throw new Error('最多同时连接 10 个会话');
    const version = rendererVersion;
    const resolved = await identities.resolve(request);
    let jump: JumpConnection | undefined;
    if (host.jumpHostId) {
      const jumpHost = store.getHost(host.jumpHostId);
      if (jumpHost.jumpHostId || jumpHost.id === host.id) throw new Error('仅支持单跳跳板机');
      const jumpIdentity = await identities.resolve({ ...request, hostId: jumpHost.id, password: request.jumpPassword, passphrase: request.jumpPassphrase });
      jump = { host: { ...jumpHost, username: jumpIdentity.username }, auth: jumpIdentity.auth };
    }
    if (version !== rendererVersion || !window || window.isDestroyed()) throw new Error('连接请求已取消，请重新连接');
    // Recheck after asynchronous Keychain access; another request may have opened the same tab.
    if (sessions.size >= 10 || [...sessions.values()].some(session => session.tabId === request.tabId)) throw new Error('此标签已有连接或会话数已达上限');
    if (request.remember) {
      if (host.identityId && [...sessions.values()].some(s => s.host.identityId === host.identityId || s.jumpHost?.identityId === host.identityId)) throw new Error('请先断开使用此身份的其他会话再保存密码');
      await identities.remember(host.id, resolved.auth, t('身份'));
    }
    if (version !== rendererVersion || !window || window.isDestroyed()) throw new Error('连接请求已取消');
    if (sessions.size >= 10 || [...sessions.values()].some(session => session.tabId === request.tabId)) throw new Error('此标签已有连接或会话数已达上限');
    const latestHost = store.getHost(host.id);
    if (host.address !== latestHost.address || host.port !== latestHost.port || (!request.remember && host.username !== latestHost.username) || host.authMode !== latestHost.authMode || host.jumpHostId !== latestHost.jumpHostId || (!request.remember && host.identityId !== latestHost.identityId)) throw new Error('主机信息已修改，请使用新配置重新连接');
    const effectiveHost = { ...host, identityId: latestHost.identityId, username: resolved.username };
    let auth: AuthCredentials | undefined = resolved.auth;
    request.password = undefined; request.passphrase = undefined; request.jumpPassword = undefined; request.jumpPassphrase = undefined;
    const sessionId = randomUUID();
    const worker = utilityProcess.fork(join(__dirname, 'ssh-worker.js'), [], { serviceName: 'Harbor SSH session', stdio: 'ignore' });
    const current: RunningSession = { id: sessionId, tabId: request.tabId, host: effectiveHost, jumpHost: jump?.host, worker, connected: false, pending: new Map(), transfers: new Map() };
    sessions.set(sessionId, current);
    worker.once('spawn', () => {
      if (sessions.has(sessionId)) worker.postMessage({ type: 'connect', sessionId, host: effectiveHost, auth, jump, ...size });
      auth = undefined; jump = undefined;
    });
    worker.on('message', (event: SshEvent | { type: 'reply'; requestId: string; result?: unknown; error?: string }) => {
      if (event.type === 'reply') {
        const pending = current.pending.get(event.requestId); if (!pending) return;
        current.pending.delete(event.requestId); clearTimeout(pending.timer);
        if (event.error) pending.reject(new Error(event.error)); else pending.resolve(event.result);
        return;
      }
      if (!sessions.has(sessionId) || event.sessionId !== sessionId) return;
      if (event.type === 'hostkey') {
        const checking = event.hostId === current.jumpHost?.id ? current.jumpHost : current.host;
        if (!checking || checking.id !== event.hostId || event.address !== checking.address || event.port !== checking.port) { closeSession(sessionId); return; }
        const expected = store.fingerprint(checking.address, checking.port);
        if (expected === event.fingerprint) worker.postMessage({ type: 'trust', accept: true });
        else if (expected) {
          notify({ type: 'error', sessionId, tabId: current.tabId, message: '主机指纹已变化，连接已阻断。请核实服务器身份后，在「已信任主机」中移除旧指纹，再重新连接。' });
          closeSession(sessionId);
        } else { current.pendingFingerprint = { value: event.fingerprint, host: checking }; notify({ ...event, tabId: current.tabId }); }
        return;
      }
      if (event.type === 'transfer') {
        const transfer = current.transfers.get(event.transfer.id);
        if (!transfer) return;
        if (event.transfer.state !== 'running') {
          current.transfers.delete(event.transfer.id);
          if (transfer.temp) {
            try { if (event.transfer.state === 'completed') renameSync(transfer.temp, transfer.destination!); }
            catch { event.transfer.state = 'failed'; event.transfer.message = '无法保存本地文件，请检查目标目录权限'; }
            finally { if (!removePartial(transfer.temp)) { event.transfer.state = 'failed'; event.transfer.message = '无法清理本地临时文件，请检查下载目录权限'; } }
          }
        }
      }
      if (event.type === 'status') current.connected = event.state === 'connected';
      if (event.type === 'interactive') current.challenge = { requestId: event.requestId, count: event.prompts.length };
      notify({ ...event, tabId: current.tabId, ...(event.type === 'status' ? { host: current.host } : {}) });
      if (event.type === 'status' && event.state === 'disconnected') closeSession(sessionId);
    });
    worker.once('exit', () => {
      current.exited = true;
      auth = undefined; jump = undefined;
      if (!sessions.has(sessionId)) return;
      closeSession(sessionId);
      notify({ type: 'error', sessionId, tabId: current.tabId, message: 'SSH 工作进程已退出，请重新连接。' });
      notify({ type: 'status', sessionId, tabId: current.tabId, state: 'disconnected', host: current.host });
    });
    return sessionId;
  });
  handle('session:trust', (id, accept) => {
    const current = owned(id);
    if (!current?.pendingFingerprint || typeof accept !== 'boolean') throw new Error('指纹确认请求已失效');
    if (!accept) { closeSession(current.id); return; }
    const expected = store.fingerprint(current.pendingFingerprint.host.address, current.pendingFingerprint.host.port);
    if (expected && expected !== current.pendingFingerprint.value) { closeSession(current.id); throw new Error('另一会话已保存不同指纹，请重新核实主机身份'); }
    store.trust(current.pendingFingerprint.host.address, current.pendingFingerprint.host.port, current.pendingFingerprint.value);
    current.pendingFingerprint = undefined;
    current.worker.postMessage({ type: 'trust', accept: true });
  });
  handle('session:answer', (id, requestId, answers) => {
    const current = owned(id);
    if (!current?.challenge || current.challenge.requestId !== requestId) throw new Error('交互认证请求已失效');
    if (answers === null) { closeSession(current.id); return; }
    if (!Array.isArray(answers) || answers.length !== current.challenge.count || answers.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) throw new Error('认证回答格式不正确');
    current.challenge = undefined;
    current.worker.postMessage({ type: 'answer', requestId, answers });
  });
  handle('sftp:list', (id, path) => rpc(connected(id), { method: 'list', path: remotePath(path) }));
  handle('sftp:upload', async (id, directory) => {
    const current = connected(id); const remote = remotePath(directory);
    const selection = await dialog.showOpenDialog(window!, { title: t('选择要上传的文件'), properties: ['openFile'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    if (owned(id) !== current || !current.connected) throw new Error('原会话已结束');
    const localPath = selection.filePaths[0]; if (!statSync(localPath).isFile()) throw new Error('仅支持上传普通文件');
    const transferId = randomUUID(); current.transfers.set(transferId, {});
    try { return await rpc(current, { method: 'transfer', id: transferId, direction: 'upload', localPath, remotePath: posix.join(remote, basename(localPath)), name: basename(localPath) }); }
    catch (error) { current.transfers.delete(transferId); throw error; }
  });
  handle('sftp:download', async (id, path) => {
    const current = connected(id); const remote = remotePath(path);
    const selection = await dialog.showSaveDialog(window!, { title: t('下载文件到'), defaultPath: basename(remote), properties: ['showOverwriteConfirmation'] });
    if (selection.canceled || !selection.filePath) return null;
    if (owned(id) !== current || !current.connected) throw new Error('原会话已结束');
    const transferId = randomUUID(), destination = selection.filePath;
    const temp = join(dirname(destination), `.harbor-${transferId}.part`);
    writeFileSync(temp, '', { flag: 'wx', mode: 0o600 }); current.transfers.set(transferId, { temp, destination });
    try { return await rpc(current, { method: 'transfer', id: transferId, direction: 'download', localPath: temp, remotePath: remote, name: basename(remote) }); }
    catch (error) { current.transfers.delete(transferId); removePartial(temp); throw error; }
  });
  handle('sftp:cancel', (id, transferId) => {
    const current = connected(id); if (typeof transferId !== 'string' || !current.transfers.has(transferId)) return;
    return rpc(current, { method: 'cancel', id: transferId });
  });
  handle('forward:list', id => rpc(connected(id), { method: 'forwards' }));
  handle('forward:start', (id, input) => rpc(connected(id), { method: 'forwardStart', input: forwardInput(input) }));
  handle('forward:stop', (id, forwardId) => {
    if (typeof forwardId !== 'string' || forwardId.length > 64) throw new Error('转发标识无效');
    return rpc(connected(id), { method: 'forwardStop', id: forwardId });
  });
  handle('session:disconnect', id => { const current = owned(id); if (current) closeSession(current.id); });
  ipcMain.on('session:input', (event, id, data) => {
    if (trustedSender(event) && typeof data === 'string' && data.length <= 65536) owned(id)?.worker.postMessage({ type: 'input', data });
  });
  ipcMain.on('session:resize', (event, id, columns, rows) => {
    if (!trustedSender(event)) return;
    try { owned(id)?.worker.postMessage({ type: 'resize', ...dimensions(columns, rows) }); } catch { /* Ignore stale/invalid resize events. */ }
  });
  ipcMain.on('session:ack', (event, id) => { if (trustedSender(event)) owned(id)?.worker.postMessage({ type: 'ack' }); });
}
function createWindow(): void {
  window = new BrowserWindow({ width: 1220, height: 790, minWidth: 900, minHeight: 600, title: 'Harbor SSH', backgroundColor: '#17191b',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-start-loading', closeAll);
  window.webContents.on('render-process-gone', closeAll);
  window.on('closed', () => { closeAll(); keyImports.clear(); window = undefined; });
  void window.loadFile(indexPath);
}
function updateMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Harbor SSH', submenu: [{ role: 'about', label: t('关于 Harbor SSH') }, { type: 'separator' }, { role: 'quit', label: t('退出 Harbor SSH') }] },
    { label: t('编辑'), submenu: [{ role: 'undo', label: t('撤销') }, { role: 'redo', label: t('重做') }, { type: 'separator' }, { role: 'cut', label: t('剪切') }, { role: 'copy', label: t('复制') }, { role: 'paste', label: t('粘贴') }, { role: 'selectAll', label: t('全选') }] },
    { label: t('窗口'), submenu: [{ role: 'minimize', label: t('最小化') }, { role: 'zoom', label: t('缩放') }, { role: 'close', label: t('关闭') }] }
  ]));
}
if (ownsProfile) app.whenReady().then(() => {
  app.setName('Harbor SSH');
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  store = new Store(join(dir, 'harbor.sqlite'));
  vault = new Vault(join(dir, 'vault-key.bin'), {
    available: async () => ['darwin', 'win32'].includes(process.platform) && await safeStorage.isAsyncEncryptionAvailable(),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value)
  }, () => store.hasIdentities());
  identities = new Identities(store, vault);
  setupIPC();
  updateMenu();
  createWindow();
  app.on('activate', () => { if (!window) createWindow(); });
}).catch(() => { dialog.showErrorBox('Harbor SSH 无法启动', '无法初始化应用数据。请保留原数据库并检查文件访问权限或数据库版本。'); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  quitting = true;
  const workers = new Set([...closingWorkers, ...[...sessions.values()].map(item => item.worker)]);
  if (!workers.size) return;
  event.preventDefault();
  const drained = Promise.all([...workers].map(worker => new Promise<void>(resolve => worker.once('exit', () => resolve()))));
  closeAll();
  const deadline = new Promise<void>(resolve => { const timer = setTimeout(resolve, 4500); timer.unref(); });
  void Promise.race([drained, deadline]).finally(() => app.quit());
});
app.on('will-quit', () => { vault?.close(); store?.close(); });

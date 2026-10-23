import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { Host, HostInput, KnownHost, WorkspaceState } from '../shared';

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}格式不正确`);
  const result = value.trim();
  if (required && !result) throw new Error(`请填写${label}`);
  return result;
}
export function normalizeAddress(value: unknown): string {
  const address = text(value, '服务器地址', 253).replace(/^\[([\da-fA-F:]+)\]$/, '$1');
  if (isIP(address)) return address.toLowerCase();
  const ascii = domainToASCII(address).toLowerCase().replace(/\.$/, '');
  if (!ascii || ascii.length > 253 || !ascii.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('服务器地址应为 IP 或域名，不包含协议、路径或端口');
  return ascii;
}
export function validPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) throw new Error('端口应为 1 至 65535 的整数');
  return value;
}
export function validateHost(value: unknown): HostInput & { id?: string } {
  if (!value || typeof value !== 'object') throw new Error('主机信息格式不正确');
  const v = value as Record<string, unknown>;
  // Reject secrets at the persistence boundary, even if an IPC caller sends extra fields.
  if (Object.keys(v).some(k => !['id', 'name', 'address', 'port', 'username', 'group', 'identityId', 'authMode', 'jumpHostId'].includes(k))) throw new Error('主机信息包含不支持的字段');
  if (v.authMode !== undefined && !['password', 'privateKey', 'interactive'].includes(String(v.authMode))) throw new Error('认证方式无效');
  if (v.authMode === 'privateKey' && !v.identityId) throw new Error('私钥认证需要选择身份');
  const identityId = v.identityId == null ? null : text(v.identityId, '身份标识', 64);
  return { identityId, jumpHostId: v.jumpHostId == null ? null : text(v.jumpHostId, '跳板机标识', 64), authMode: v.authMode as HostInput['authMode'] ?? 'password', ...(v.id === undefined ? {} : { id: text(v.id, '主机标识', 64) }), name: text(v.name, '主机名称', 80), address: normalizeAddress(v.address), port: validPort(v.port), username: identityId ? '' : text(v.username, '用户名', 128), group: text(v.group, '分组', 60, false) };
}
export class Store {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    try {
      if (path !== ':memory:') chmodSync(path, 0o600);
      this.db.pragma('foreign_keys = ON');
      const version = this.db.pragma('user_version', { simple: true }) as number;
      if (version > 3) throw new Error('数据库来自更新版本，请使用兼容的应用；数据未修改。');
      if (version > 0 && version < 3 && path !== ':memory:' && !existsSync(path + `.v${version}-backup.sqlite`)) {
        this.db.prepare('VACUUM INTO ?').run(path + `.v${version}-backup.sqlite`);
        chmodSync(path + `.v${version}-backup.sqlite`, 0o600);
      }
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535), username TEXT NOT NULL, group_name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS known_hosts (address TEXT NOT NULL, port INTEGER NOT NULL, fingerprint TEXT NOT NULL, trusted_at TEXT NOT NULL, PRIMARY KEY(address, port));
          CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), content TEXT NOT NULL);`);
        if (version < 2) this.db.exec(`ALTER TABLE hosts ADD COLUMN identity_id TEXT REFERENCES identities(id) ON DELETE RESTRICT;
          ALTER TABLE hosts ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password' CHECK(auth_mode IN ('password','privateKey','interactive'));
          PRAGMA user_version = 2;`);
        if (version < 3) this.db.exec(`ALTER TABLE hosts ADD COLUMN jump_host_id TEXT REFERENCES hosts(id) ON DELETE RESTRICT; PRAGMA user_version = 3;`);
      })();
    } catch (error) { this.db.close(); throw error; }
  }
  listHosts(): Host[] {
    return this.db.prepare('SELECT id, name, address, port, username, group_name AS "group", identity_id AS identityId, auth_mode AS authMode, jump_host_id AS jumpHostId FROM hosts ORDER BY group_name, name, id').all() as Host[];
  }
  getHost(id: string): Host {
    if (typeof id !== 'string') throw new Error('主机不存在');
    const host = this.db.prepare('SELECT id, name, address, port, username, group_name AS "group", identity_id AS identityId, auth_mode AS authMode, jump_host_id AS jumpHostId FROM hosts WHERE id = ?').get(id) as Host | undefined;
    if (!host) throw new Error('主机不存在');
    return host;
  }
  saveHost(value: unknown): Host {
    const input = validateHost(value);
    if (input.id) this.getHost(input.id);
    if (input.identityId) this.identityRow(input.identityId);
    if (input.jumpHostId) {
      const jump = this.getHost(input.jumpHostId);
      if (jump.id === input.id || jump.jumpHostId || (input.id && this.db.prepare('SELECT 1 FROM hosts WHERE jump_host_id=?').get(input.id))) throw new Error('仅支持单跳跳板机，不能引用自己或形成多跳链路');
    }
    const host = { ...input, id: input.id ?? randomUUID() };
    this.db.prepare('INSERT INTO hosts (id,name,address,port,username,group_name,identity_id,auth_mode,jump_host_id) VALUES (@id,@name,@address,@port,@username,@group,@identityId,@authMode,@jumpHostId) ON CONFLICT(id) DO UPDATE SET name=@name,address=@address,port=@port,username=@username,group_name=@group,identity_id=@identityId,auth_mode=@authMode,jump_host_id=@jumpHostId').run(host);
    return host;
  }
  deleteHost(id: string): void { this.getHost(id); if (this.db.prepare('SELECT 1 FROM hosts WHERE jump_host_id=?').get(id)) throw new Error('此主机正被用作跳板机，请先解除关联'); this.db.prepare('DELETE FROM hosts WHERE id = ?').run(id); }
  listKnownHosts(): KnownHost[] {
    return this.db.prepare('SELECT address,port,fingerprint,trusted_at AS trustedAt FROM known_hosts ORDER BY address,port').all() as KnownHost[];
  }
  fingerprint(address: string, port: number): string | undefined {
    return (this.db.prepare('SELECT fingerprint FROM known_hosts WHERE address=? AND port=?').get(address, port) as { fingerprint: string } | undefined)?.fingerprint;
  }
  trust(address: string, port: number, fingerprint: string): void {
    this.db.prepare('INSERT INTO known_hosts VALUES (?,?,?,?) ON CONFLICT(address,port) DO UPDATE SET fingerprint=excluded.fingerprint,trusted_at=excluded.trusted_at').run(address, port, fingerprint, new Date().toISOString());
  }
  forget(address: unknown, port: unknown): void { this.db.prepare('DELETE FROM known_hosts WHERE address=? AND port=?').run(normalizeAddress(address), validPort(port)); }
  hasIdentities(): boolean { return !!this.db.prepare('SELECT 1 FROM identities LIMIT 1').get(); }
  identityRows(): { id: string; ciphertext: Buffer }[] { return this.db.prepare('SELECT id,ciphertext FROM identities ORDER BY rowid').all() as { id: string; ciphertext: Buffer }[]; }
  identityRow(id: string): { id: string; ciphertext: Buffer } {
    if (typeof id !== 'string') throw new Error('身份不存在');
    const row = this.db.prepare('SELECT id,ciphertext FROM identities WHERE id=?').get(id) as { id: string; ciphertext: Buffer } | undefined;
    if (!row) throw new Error('身份不存在');
    return row;
  }
  saveIdentityRow(id: string, ciphertext: Buffer): void {
    this.db.prepare('INSERT INTO identities VALUES (?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext').run(id, ciphertext);
  }
  saveBoundIdentity(hostId: string, identityId: string, ciphertext: Buffer): void {
    this.db.transaction(() => {
      const host = this.getHost(hostId);
      this.saveIdentityRow(identityId, ciphertext);
      this.saveHost({ ...host, identityId });
    })();
  }
  deleteIdentity(id: string): void {
    this.identityRow(id);
    if (this.db.prepare('SELECT 1 FROM hosts WHERE identity_id=? LIMIT 1').get(id)) throw new Error('此身份仍被主机引用，请先修改主机的身份设置');
    this.db.prepare('DELETE FROM identities WHERE id=?').run(id);
  }
  getWorkspace(): WorkspaceState {
    const row = this.db.prepare('SELECT content FROM workspace WHERE id=1').get() as { content: string } | undefined;
    const empty: WorkspaceState = { tabs: [], activeTabId: null, selectedHostId: null };
    if (!row) return empty;
    try {
      const data = JSON.parse(row.content) as WorkspaceState;
      const ids = new Set(this.listHosts().map(host => host.id));
      const tabs = data.tabs.filter(tab => ids.has(tab.hostId));
      return { tabs, activeTabId: tabs.some(tab => tab.id === data.activeTabId) ? data.activeTabId : tabs[0]?.id ?? null, selectedHostId: data.selectedHostId && ids.has(data.selectedHostId) ? data.selectedHostId : null };
    } catch { throw new Error('工作区数据无法读取，请保留数据库并检查备份'); }
  }
  saveWorkspace(input: unknown): void {
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['tabs','activeTabId','selectedHostId'].includes(k))) throw new Error('工作区格式无效');
    const value = input as WorkspaceState;
    if (!Array.isArray(value.tabs) || value.tabs.length > 10) throw new Error('最多保留 10 个终端标签');
    const ids = new Set<string>();
    for (const tab of value.tabs) {
      if (!tab || Object.keys(tab).some(k => !['id','hostId'].includes(k)) || typeof tab.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(tab.id) || ids.has(tab.id)) throw new Error('终端标签格式无效');
      ids.add(tab.id); this.getHost(tab.hostId);
    }
    if (value.activeTabId !== null && !ids.has(value.activeTabId)) throw new Error('当前标签无效');
    if (value.selectedHostId !== null) this.getHost(value.selectedHostId);
    this.db.prepare('INSERT INTO workspace VALUES (1,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content').run(JSON.stringify({ tabs: value.tabs.map(tab => ({ id: tab.id, hostId: tab.hostId })), activeTabId: value.activeTabId, selectedHostId: value.selectedHostId }));
  }
  close(): void { this.db.close(); }
}

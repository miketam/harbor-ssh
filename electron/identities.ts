import { createPrivateKey, randomUUID } from 'node:crypto';
import { utils } from 'ssh2';
import type { AuthCredentials, AuthMode, ConnectRequest, IdentityInput, IdentitySummary, SecretChange } from '../shared';
import { Store } from './store';
import { Vault } from './vault';

interface IdentityRecord { name: string; username: string; method: AuthMode; password: string; privateKey: string; passphrase: string; requiresPassphrase: boolean }
export const authModes: AuthMode[] = ['password', 'privateKey', 'interactive'];
function valueString(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('身份字段格式无效');
  return value;
}
function label(value: unknown): string {
  const s = valueString(value, 128).trim();
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) throw new Error('请填写有效的身份名称和用户名');
  return s;
}
function patch(input: unknown, previous: string, max: number): string {
  if (!input || typeof input !== 'object') throw new Error('请选择保留、替换或清除秘密字段');
  const p = input as SecretChange;
  if (p.action === 'keep' && Object.keys(p).length === 1) return previous;
  if (p.action === 'clear' && Object.keys(p).length === 1) return '';
  if (p.action === 'replace' && Object.keys(p).every(k => k === 'action' || k === 'value')) return valueString(p.value, max);
  throw new Error('秘密字段更新方式无效');
}
export function preparePrivateKey(privateKey: string, passphrase: string): string {
  const value = privateKey.trim().replace(/^\uFEFF/, '');
  if (!/^-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(value)) return value;
  try {
    const key = createPrivateKey({ key: value, format: 'pem', passphrase: passphrase || undefined });
    if (key.asymmetricKeyType === 'rsa') return key.export({ type: 'pkcs1', format: 'pem' }).toString();
    if (key.asymmetricKeyType === 'ec') return key.export({ type: 'sec1', format: 'pem' }).toString();
  } catch { throw new Error('私钥格式或 passphrase 不正确'); }
  throw new Error('当前 PKCS#8 私钥仅支持 RSA 和 EC，请转换其他类型为 OpenSSH 格式');
}
export function inspectPrivateKey(privateKey: string, passphrase: string): boolean {
  if (!passphrase && privateKey.trim().startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----')) return true;
  const key = utils.parseKey(preparePrivateKey(privateKey, passphrase), passphrase || undefined);
  if (key instanceof Error) {
    if (!passphrase && /encrypted.*(?:no passphrase|passphrase given|passphrase)|no passphrase.*encrypted/i.test(key.message)) return true;
    throw new Error('私钥格式或 passphrase 不正确，请使用受支持的 OpenSSH / PEM 私钥。');
  }
  if (!key.isPrivateKey()) throw new Error('请选择私钥文件，不能使用公钥文件');
  return false;
}
function summary(id: string, value: IdentityRecord): IdentitySummary {
  return { id, name: value.name, username: value.username, method: value.method, hasPassword: !!value.password, hasPassphrase: !!value.passphrase, requiresPassphrase: value.requiresPassphrase };
}
export class Identities {
  constructor(private store: Store, private vault: Vault) {}
  async list(): Promise<IdentitySummary[]> {
    const rows = this.store.identityRows();
    if (!rows.length) return [];
    await this.vault.open();
    return rows.map(row => summary(row.id, this.vault.decrypt<IdentityRecord>(row.id, row.ciphertext)));
  }
  async save(input: unknown): Promise<IdentitySummary> {
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['id', 'name', 'username', 'method', 'password', 'privateKey', 'passphrase'].includes(k))) throw new Error('身份信息格式不正确');
    const v = input as IdentityInput;
    if (!authModes.includes(v.method)) throw new Error('认证方式无效');
    const name = label(v.name), username = label(v.username);
    const id = v.id === undefined ? randomUUID() : valueString(v.id, 64);
    const oldRow = v.id === undefined ? undefined : this.store.identityRow(id);
    await this.vault.open();
    const old = oldRow ? this.vault.decrypt<IdentityRecord>(id, oldRow.ciphertext) : undefined;
    const record: IdentityRecord = { name, username, method: v.method, password: patch(v.password, old?.password ?? '', 4096), privateKey: patch(v.privateKey, old?.privateKey ?? '', 65536), passphrase: patch(v.passphrase, old?.passphrase ?? '', 4096), requiresPassphrase: false };
    if (record.method === 'privateKey') {
      if (!record.privateKey.trim()) throw new Error('私钥身份必须包含私钥');
      record.requiresPassphrase = inspectPrivateKey(record.privateKey, record.passphrase);
      record.password = '';
    } else {
      record.privateKey = ''; record.passphrase = '';
      if (record.method === 'interactive') record.password = '';
    }
    this.store.saveIdentityRow(id, this.vault.encrypt(id, record));
    return summary(id, record);
  }
  async remember(hostId: string, auth: AuthCredentials, identitySuffix = '身份'): Promise<void> {
    if (auth.method === 'interactive') throw new Error('交互认证的回答不能保存');
    await this.vault.open();
    const host = this.store.getHost(hostId), id = host.identityId ?? randomUUID();
    const record: IdentityRecord = host.identityId
      ? this.vault.decrypt(id, this.store.identityRow(id).ciphertext)
      : { name: `${host.name} ${identitySuffix}`, username: host.username, method: auth.method, password: '', privateKey: '', passphrase: '', requiresPassphrase: false };
    if (auth.method !== record.method) throw new Error('身份方式已变化，请重新连接');
    if (auth.method === 'password') record.password = auth.password;
    else { record.passphrase = auth.passphrase; record.requiresPassphrase = false; }
    this.store.saveBoundIdentity(hostId, id, this.vault.encrypt(id, record));
  }
  async resolve(request: ConnectRequest): Promise<{ username: string; auth: AuthCredentials }> {
    const host = this.store.getHost(request.hostId);
    const temporaryPassword = request.password === undefined ? undefined : valueString(request.password, 4096);
    const temporaryPassphrase = request.passphrase === undefined ? undefined : valueString(request.passphrase, 4096);
    let identity: IdentityRecord | undefined;
    if (host.identityId) {
      const row = this.store.identityRow(host.identityId);
      await this.vault.open(); identity = this.vault.decrypt<IdentityRecord>(row.id, row.ciphertext);
    }
    const method = identity?.method ?? host.authMode ?? 'password';
    const username = identity?.username ?? host.username;
    if (method === 'interactive') return { username, auth: { method } };
    if (method === 'password') {
      const password = temporaryPassword ?? identity?.password ?? '';
      if (!password) throw new Error('请输入本次连接的密码，或在身份库中保存密码');
      return { username, auth: { method, password } };
    }
    if (!identity?.privateKey) throw new Error('请先为主机选择一个私钥身份');
    const passphrase = temporaryPassphrase ?? identity.passphrase;
    if (inspectPrivateKey(identity.privateKey, passphrase)) throw new Error('私钥已加密，请输入本次连接的 passphrase');
    return { username, auth: { method, privateKey: preparePrivateKey(identity.privateKey, passphrase), passphrase } };
  }
}

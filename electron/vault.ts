import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import type { VaultStatus } from '../shared';

export interface KeyProtector {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
const unavailable = '无法访问系统密钥保护，身份库未解锁。请恢复系统密钥保护访问后重试；原有数据不会被覆盖。';
export class Vault {
  private key?: Buffer;
  private loading?: Promise<void>;
  private failure = '';
  constructor(private file: string, private protector: KeyProtector, private hasRecords: () => boolean) {}
  status(): VaultStatus {
    return this.key ? { state: 'ready', message: '身份库已由系统密钥保护' }
      : this.failure ? { state: 'unavailable', message: this.failure }
      : { state: 'new', message: '首次保存身份时创建加密身份库' };
  }
  async open(): Promise<void> {
    if (this.key) return;
    if (!this.loading) this.loading = this.load().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private async load(): Promise<void> {
    try {
      if (!(await this.protector.available())) throw new Error(unavailable);
      let key: Buffer;
      if (existsSync(this.file)) {
        const wrapped = readFileSync(this.file);
        const decoded = await this.protector.decrypt(wrapped);
        if (!/^[A-Za-z0-9+/]{43}=$/.test(decoded.result)) throw new Error(unavailable);
        key = Buffer.from(decoded.result, 'base64');
        if (key.length !== 32) throw new Error(unavailable);
        chmodSync(this.file, 0o600);
        if (decoded.shouldReEncrypt) this.writeWrapped(await this.protector.encrypt(decoded.result), true);
      } else {
        if (this.hasRecords()) throw new Error('身份库密钥文件缺失。请恢复原密钥文件；为保护已有身份，不会创建替代密钥。');
        key = randomBytes(32);
        try { this.writeWrapped(await this.protector.encrypt(key.toString('base64')), false); }
        catch (error) { key.fill(0); throw error; }
      }
      this.key = key;
      this.failure = '';
    } catch (error) {
      this.failure = error instanceof Error && error.message.startsWith('身份库密钥文件缺失') ? error.message : unavailable;
      throw new Error(this.failure);
    }
  }
  private writeWrapped(value: Buffer, replace: boolean): void {
    if (!value.length) throw new Error(unavailable);
    if (!replace) { writeFileSync(this.file, value, { flag: 'wx', mode: 0o600 }); return; }
    const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try { writeFileSync(temp, value, { flag: 'wx', mode: 0o600 }); renameSync(temp, this.file); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
    chmodSync(this.file, 0o600);
  }
  encrypt(id: string, value: object): Buffer {
    if (!this.key) throw new Error('请先解锁身份库');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(`harbor:identity:v1:${id}`));
    const plain = Buffer.from(JSON.stringify(value));
    try {
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const keyId = createHash('sha256').update(this.key).digest().subarray(0, 8);
      return Buffer.concat([Buffer.from([1]), keyId, nonce, cipher.getAuthTag(), ciphertext]);
    } finally { plain.fill(0); }
  }
  decrypt<T>(id: string, value: Buffer): T {
    if (!this.key) throw new Error('请先解锁身份库');
    let plain: Buffer | undefined;
    try {
      if (!Buffer.isBuffer(value) || value.length < 38 || value[0] !== 1 || !value.subarray(1, 9).equals(createHash('sha256').update(this.key).digest().subarray(0, 8))) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(9, 21));
      decipher.setAAD(Buffer.from(`harbor:identity:v1:${id}`));
      decipher.setAuthTag(value.subarray(21, 37));
      plain = Buffer.concat([decipher.update(value.subarray(37)), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as T;
    } catch { throw new Error('身份数据完整性校验失败，无法解密；请保留原文件并检查备份。'); }
    finally { plain?.fill(0); }
  }
  close(): void { this.key?.fill(0); this.key = undefined; }
}

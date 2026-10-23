import { createHash, randomUUID } from 'node:crypto';
import { Client, type ClientChannel } from 'ssh2';
import { SessionResources } from './resources';
import type { Host, SshEvent, AuthCredentials, JumpConnection, ResourceRequest } from '../shared';

export function fingerprint(key: Buffer): string { return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''); }
export function safeSshError(error: Error & { level?: string; code?: string }): string {
  if (error.level === 'client-authentication') return '认证失败，请检查用户名及认证信息。';
  if (error.code === 'ECONNREFUSED') return '服务器拒绝连接，请检查地址、端口及 SSH 服务。';
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') return '无法解析服务器地址。';
  if (error.code === 'ETIMEDOUT' || error.level === 'client-timeout') return '连接超时，请检查服务器和网络。';
  return 'SSH 连接失败，请检查网络、服务端配置或主机指纹。';
}
export class SshSession {
  private client = new Client();
  private channel?: ClientChannel;
  private jumpClient?: Client;
  private resources?: SessionResources;
  private hostDecision?: (accept: boolean) => void;
  private challenge?: { id: string; count: number; finish: (answers: string[]) => void };
  private challengeTimer?: ReturnType<typeof setTimeout>;
  private rounds = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private ended = false;
  private closing?: Promise<void>;
  private size = { columns: 100, rows: 30 };
  constructor(private id: string, private emit: (event: SshEvent) => void) {}
  connect(host: Host, credentials: AuthCredentials | string, columns: number, rows: number, jump?: JumpConnection): void {
    const auth: AuthCredentials = typeof credentials === 'string' ? { method: 'password', password: credentials } : credentials;
    this.size = { columns, rows };
    this.emit({ type: 'status', sessionId: this.id, state: 'connecting' });
    const openTarget = (sock?: ClientChannel) => this.configure(this.client, host, auth, () => this.openShell(), sock);
    if (jump) {
      this.jumpClient = new Client();
      this.configure(this.jumpClient, jump.host, jump.auth, () => {
        this.jumpClient!.forwardOut('127.0.0.1', 0, host.address, host.port, (error, channel) => {
          if (error || this.ended) { channel?.destroy(); if (!this.ended) { this.emit({ type: 'error', sessionId: this.id, message: '跳板机无法访问目标服务器，请检查地址及转发权限。' }); this.close(); } return; }
          openTarget(channel);
        });
      });
    } else openTarget();
  }
  private openShell(): void {
    if (this.ended) return;
    this.resources = new SessionResources(this.client, this.id, this.emit);
    this.client.shell({ term: 'xterm-256color', cols: this.size.columns, rows: this.size.rows }, (error, channel) => {
      if (error) { this.emit({ type: 'error', sessionId: this.id, message: '认证成功，但服务器无法创建交互终端。' }); this.close(); return; }
      if (this.ended) { channel.close(); return; }
      this.channel = channel;
      const output = (data: Buffer) => { channel.pause(); channel.stderr.pause(); this.emit({ type: 'data', sessionId: this.id, data: new Uint8Array(data) }); };
      channel.on('data', output); channel.stderr.on('data', output); channel.on('close', () => this.close()); channel.on('error', () => this.close());
      this.emit({ type: 'status', sessionId: this.id, state: 'connected' });
    });
  }
  private configure(client: Client, host: Host, auth: AuthCredentials, onReady: () => void, sock?: ClientChannel): void {
    client.on('error', error => {
      if (!this.ended) this.emit({ type: 'error', sessionId: this.id, message: safeSshError(error) });
      this.close();
    });
    client.on('close', () => this.close());
    client.on('ready', onReady);
    client.on('keyboard-interactive', (name, instructions, _language, prompts, finish) => {
      if (this.ended) return;
      if (++this.rounds > 8 || prompts.length > 16 || name.length > 512 || instructions.length > 4096 || prompts.some(p => p.prompt.length > 512)) {
        this.emit({ type: 'error', sessionId: this.id, message: '服务器认证问题超出允许范围，连接已结束。' }); this.close(); return;
      }
      if (!prompts.length) { finish([]); return; }
      const requestId = randomUUID();
      this.challenge = { id: requestId, count: prompts.length, finish };
      this.challengeTimer = setTimeout(() => {
        this.emit({ type: 'error', sessionId: this.id, message: '等待交互认证超时，请重新连接。' }); this.close();
      }, 90_000);
      this.emit({ type: 'interactive', sessionId: this.id, requestId, hostName: host.name, name, instructions, prompts: prompts.map(p => ({ prompt: p.prompt, echo: !!p.echo })) });
    });
    client.connect({ ...(sock ? { sock } : {}), host: host.address, port: host.port, username: host.username,
      ...(auth.method === 'password' ? { password: auth.password } : auth.method === 'privateKey' ? { privateKey: auth.privateKey, passphrase: auth.passphrase || undefined } : {}),
      readyTimeout: 180_000, keepaliveInterval: 30_000, keepaliveCountMax: 3, tryKeyboard: true,
      authHandler: auth.method === 'password' ? ['password','keyboard-interactive'] : auth.method === 'privateKey' ? ['publickey','keyboard-interactive'] : ['keyboard-interactive'],
      hostVerifier: (key: Buffer, callback: (accept: boolean) => void) => {
        this.hostDecision = callback;
        this.timer = setTimeout(() => { this.decide(false); this.emit({ type: 'error', sessionId: this.id, message: '等待指纹确认超时，请重新连接。' }); this.close(); }, 60_000);
        this.emit({ type: 'hostkey', sessionId: this.id, hostId: host.id, address: host.address, port: host.port, fingerprint: fingerprint(key) });
      }
    });
  }
  request(request: ResourceRequest): Promise<unknown> {
    if (!this.resources || !this.channel || this.ended) return Promise.reject(new Error('请先连接终端'));
    return this.resources.request(request);
  }
  decide(accept: boolean): void { clearTimeout(this.timer); const callback = this.hostDecision; this.hostDecision = undefined; callback?.(accept); }
  answer(requestId: string, answers: string[]): void {
    if (!this.challenge || this.challenge.id !== requestId || answers.length !== this.challenge.count || answers.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) return;
    clearTimeout(this.challengeTimer);
    const finish = this.challenge.finish; this.challenge = undefined;
    finish(answers);
  }
  input(data: string): void { if (!this.ended) this.channel?.write(data); }
  resize(columns: number, rows: number): void { this.size = { columns, rows }; this.channel?.setWindow(rows, columns, 0, 0); }
  acknowledge(): void { this.channel?.resume(); this.channel?.stderr.resume(); }
  close(): Promise<void> {
    if (this.ended) return this.closing ?? Promise.resolve();
    this.ended = true;
    clearTimeout(this.timer);
    clearTimeout(this.challengeTimer); this.challenge = undefined;
    this.decide(false);
    this.channel?.destroy();
    const dispose = () => { this.client.destroy(); this.jumpClient?.destroy(); };
    this.closing = this.resources ? this.resources.close().finally(dispose) : Promise.resolve().then(dispose);
    this.emit({ type: 'status', sessionId: this.id, state: 'disconnected' });
    return this.closing;
  }
}

import { createReadStream, createWriteStream } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable, type Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Client, SFTPWrapper, ClientChannel } from 'ssh2';
import type { Forward, ForwardInput, ResourceRequest, SshEvent, Transfer } from '../shared';
import { normalizeAddress, validPort } from './store';

export function remotePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('远程路径无效');
  return value;
}
export function forwardInput(value: unknown): ForwardInput {
  if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['localPort', 'remoteHost', 'remotePort'].includes(k))) throw new Error('转发配置无效');
  const v = value as ForwardInput;
  return { localPort: v.localPort === 0 ? 0 : validPort(v.localPort), remoteHost: normalizeAddress(v.remoteHost), remotePort: validPort(v.remotePort) };
}
interface TransferJob { value: Transfer; abort: AbortController; done: Promise<void> }
interface Listener { value: Forward; server: Server; sockets: Set<Socket | ClientChannel> }
export class SessionResources {
  private sftpPromise?: Promise<SFTPWrapper>;
  private transfers = new Map<string, TransferJob>();
  private listeners = new Map<string, Listener>();
  private closing = false;
  constructor(private client: Client, private sessionId: string, private emit: (event: SshEvent) => void) {}
  private sftp(): Promise<SFTPWrapper> {
    if (this.closing) return Promise.reject(new Error('会话已结束'));
    if (!this.sftpPromise) this.sftpPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      const closed = () => reject(new Error('SFTP 会话已结束'));
      this.client.once('close', closed);
      this.client.sftp((error, channel) => {
        this.client.removeListener('close', closed);
        if (error) { this.sftpPromise = undefined; reject(new Error('服务器无法打开 SFTP')); }
        else { channel.on('error', () => {}); channel.once('close', () => { this.sftpPromise = undefined; }); resolve(channel); }
      });
    });
    return this.sftpPromise;
  }
  async request(request: ResourceRequest): Promise<unknown> {
    if (this.closing) throw new Error('会话已结束');
    switch (request.method) {
      case 'list': {
        const sftp = await this.sftp(); const path = await new Promise<string>((resolve, reject) => sftp.realpath(remotePath(request.path), (error, value) => error ? reject(error) : resolve(value)));
        const entries = await new Promise<import('ssh2').FileEntryWithStats[]>((resolve, reject) => sftp.readdir(path, (error, entries) => error ? reject(error) : resolve(entries)));
        if (entries.length > 10000) throw new Error('目录项目超过 10000，请打开较小的子目录');
        return { path, entries: entries.filter(e => !['.', '..'].includes(e.filename)).map(e => ({ name: e.filename, kind: e.attrs.isDirectory() ? 'directory' : e.attrs.isFile() ? 'file' : e.attrs.isSymbolicLink() ? 'link' : 'other', size: e.attrs.size, modified: e.attrs.mtime })) };
      }
      case 'transfer': return this.startTransfer(request);
      case 'cancel': this.transfers.get(request.id)?.abort.abort(); return;
      case 'forwards': return [...this.listeners.values()].map(item => item.value);
      case 'forwardStart': return this.startForward(forwardInput(request.input));
      case 'forwardStop': await this.stopForward(request.id); return;
    }
  }
  private async startTransfer(request: Extract<ResourceRequest, { method: 'transfer' }>): Promise<{ id: string }> {
    if (this.transfers.size >= 3) throw new Error('每个会话最多同时传输 3 个文件');
    const sftp = await this.sftp();
    if (this.closing) throw new Error('会话已结束');
    const remote = remotePath(request.remotePath);
    if (request.direction !== 'upload' && request.direction !== 'download') throw new Error('传输方向无效');
    if (this.transfers.size >= 3 || this.transfers.has(request.id)) throw new Error('传输数已达上限或标识重复');
    const value: Transfer = { id: request.id, name: basename(request.name), direction: request.direction, bytes: 0, total: 0, state: 'running' };
    const abort = new AbortController();
    const job: TransferJob = { value, abort, done: Promise.resolve() };
    this.transfers.set(value.id, job);
    job.done = this.runTransfer(sftp, remote, request.localPath, job);
    return { id: value.id };
  }
  private async runTransfer(sftp: SFTPWrapper, remote: string, local: string, job: TransferJob): Promise<void> {
    const { value, abort } = job; let ownsRemote = false;
    const report = () => this.emit({ type: 'transfer', sessionId: this.sessionId, transfer: { ...value } });
    let source: Readable | undefined, destination: Writable | undefined;
    try {
      if (value.direction === 'upload') {
        value.total = (await stat(local)).size;
        const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(remote, 'wx', 0o600, (error, handle) => error ? reject(error) : resolve(handle)));
        ownsRemote = true;
        destination = sftp.createWriteStream(remote, { handle, flags: 'wx', mode: 0o600 });
        source = createReadStream(local);
      } else {
        const attrs = await new Promise<import('ssh2').Stats>((resolve, reject) => sftp.lstat(remote, (error, attrs) => error ? reject(error) : resolve(attrs)));
        if (!attrs.isFile()) throw new Error('仅支持下载普通文件');
        value.total = attrs.size;
        source = sftp.createReadStream(remote);
        destination = createWriteStream(local, { flags: 'r+', mode: 0o600 });
      }
      let last = 0;
      const progress = new Transform({ transform(chunk, _encoding, callback) {
        value.bytes += chunk.length;
        if (Date.now() - last > 100) { last = Date.now(); report(); }
        callback(null, chunk);
      } });
      report();
      await pipeline(source, progress, destination, { signal: abort.signal });
      value.state = 'completed';
    } catch {
      source?.destroy(); destination?.destroy();
      value.state = abort.signal.aborted ? 'cancelled' : 'failed';
      value.message = abort.signal.aborted ? '传输已取消' : value.direction === 'upload' ? '上传失败，请检查权限；同名文件不会覆盖。' : '下载失败，请检查文件类型、权限和连接。';
      if (ownsRemote) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { value.message += ' 远端部分文件可能残留，请检查。'; resolve(); }, 2000);
          try { sftp.unlink(remote, error => { clearTimeout(timer); if (error) value.message += ' 远端部分文件可能残留，请检查。'; resolve(); }); }
          catch { clearTimeout(timer); value.message += ' 远端部分文件可能残留，请检查。'; resolve(); }
        });
      }
    } finally {
      this.transfers.delete(value.id); report();
    }
  }
  private async startForward(input: ForwardInput): Promise<Forward> {
    if (this.listeners.size >= 10) throw new Error('每个会话最多 10 个端口转发');
    const sockets = new Set<Socket | ClientChannel>();
    const server = createServer(socket => {
      if (this.closing || sockets.size >= 128) { socket.destroy(); return; }
      sockets.add(socket); socket.on('error', () => socket.destroy()); socket.once('close', () => sockets.delete(socket));
      this.client.forwardOut('127.0.0.1', socket.remotePort ?? 0, input.remoteHost, input.remotePort, (error, channel) => {
        if (error || socket.destroyed || this.closing) { socket.destroy(); channel?.destroy(); return; }
        sockets.add(channel); channel.on('error', () => channel.destroy()); channel.once('close', () => { sockets.delete(channel); socket.destroy(); });
        socket.once('close', () => channel.destroy()); socket.pipe(channel).pipe(socket);
      });
    });
    const value: Forward = { ...input, id: randomUUID() };
    // Register before awaiting listen so concurrent requests share the same limit.
    this.listeners.set(value.id, { value, server, sockets });
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(input.localPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      if (this.closing) { await this.stopForward(value.id); throw new Error(); }
      value.localPort = (server.address() as import('node:net').AddressInfo).port;
      server.on('error', () => { void this.stopForward(value.id); });
      this.emit({ type: 'forwards', sessionId: this.sessionId }); return value;
    } catch { this.listeners.delete(value.id); server.close(); throw new Error('本地端口无法监听，可能已被占用或没有权限'); }
  }
  private async stopForward(id: string): Promise<void> {
    const listener = this.listeners.get(id); if (!listener) return;
    this.listeners.delete(id); for (const socket of listener.sockets) socket.destroy();
    await new Promise<void>(resolve => listener.server.close(() => resolve()));
    this.emit({ type: 'forwards', sessionId: this.sessionId });
  }
  async close(): Promise<void> {
    this.closing = true;
    const jobs = [...this.transfers.values()]; jobs.forEach(job => job.abort.abort());
    await Promise.allSettled([...jobs.map(job => job.done), ...[...this.listeners.keys()].map(id => this.stopForward(id))]);
  }
}

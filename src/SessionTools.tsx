import { t, useLocale } from './i18n';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Forward, RemoteEntry, Transfer } from '../shared';
import { Dialog, errorMessage } from './Dialog';
const size = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(1)} MiB`;
export function SessionTools({ sessionId, connected, hostName }: { sessionId: string | null; connected: boolean; hostName: string }) {
  useLocale();
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'files' | 'forwards'>('files');
  const [path, setPath] = useState('.'), [draft, setDraft] = useState('.'), [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]), [forwards, setForwards] = useState<Forward[]>([]);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [acting, setActing] = useState(false);
  const [localPort, setLocalPort] = useState(0), [remoteHost, setRemoteHost] = useState('127.0.0.1'), [remotePort, setRemotePort] = useState(80);
  const pathRef = useRef('.'), currentSession = useRef(sessionId), sequence = useRef(0), draftVersion = useRef(0);
  currentSession.current = sessionId;
  const load = useCallback(async (target: string) => {
    if (!sessionId) return; const request = ++sequence.current, edit = draftVersion.current; setLoading(true); setError('');
    try { const result = await window.harbor.listRemote(sessionId, target); if (currentSession.current !== sessionId || request !== sequence.current) return; setPath(result.path); pathRef.current = result.path; if (edit === draftVersion.current) setDraft(result.path); setEntries(result.entries.sort((a,b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))); }
    catch (e) { if (request === sequence.current) setError(errorMessage(e)); } finally { if (request === sequence.current) setLoading(false); }
  }, [sessionId]);
  const refreshForwards = useCallback(async () => { if (sessionId) try { const items = await window.harbor.listForwards(sessionId); if (currentSession.current === sessionId) setForwards(items); } catch (e) { setError(errorMessage(e)); } }, [sessionId]);
  useEffect(() => { sequence.current++; draftVersion.current++; setOpen(false); setEntries([]); setTransfers([]); setForwards([]); setPath('.'); pathRef.current = '.'; setDraft('.'); setError(''); setLoading(false); setActing(false); }, [sessionId]);
  useEffect(() => window.harbor.onSession(event => {
    if (event.sessionId !== sessionId) return;
    if (event.type === 'transfer') {
      setTransfers(items => [...items.filter(item => item.id !== event.transfer.id), event.transfer].slice(-30));
      if (event.transfer.state === 'completed' && event.transfer.direction === 'upload') void load(pathRef.current);
    } else if (event.type === 'forwards') void refreshForwards();
    else if (event.type === 'status' && event.state === 'disconnected') { setForwards([]); setTransfers(items => items.map(item => item.state === 'running' ? { ...item, state: 'cancelled', message: '会话已断开，传输已终止' } : item)); }
  }), [sessionId, load, refreshForwards]);
  async function action(fn: () => Promise<unknown>) { setActing(true); setError(''); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setActing(false); } }
  const remote = (name: string) => `${path === '/' ? '' : path}/${name}`;
  async function startForward(event: FormEvent) { event.preventDefault(); if (sessionId) await action(async () => { await window.harbor.startForward(sessionId, { localPort, remoteHost, remotePort }); await refreshForwards(); }); }
  return <><div className="session-tools-bar"><span>{connected ? t("当前会话") : t("连接后可使用文件与转发")}</span><button className="quiet-button" disabled={!connected} onClick={() => { setOpen(true); void load(path); void refreshForwards(); }}>{t("文件与转发")}</button></div>
    {open && <Dialog title={t("文件与转发 · {0}", hostName)} onClose={() => setOpen(false)}>
      <div className="tool-switch"><button className={mode === 'files' ? 'primary-button' : 'quiet-button'} aria-pressed={mode === 'files'} onClick={() => setMode('files')}>{t("SFTP 文件")}</button><button className={mode === 'forwards' ? 'primary-button' : 'quiet-button'} aria-pressed={mode === 'forwards'} onClick={() => setMode('forwards')}>{t("本地端口转发")}</button></div>
      {!connected && <p className="form-error" role="alert">{t("会话已断开。传输与转发不会在重连或重启后自动恢复。")}</p>}
      {mode === 'files' ? <>
        <form className="remote-navigation" onSubmit={event => { event.preventDefault(); void load(draft); }}><label>{t("远程目录")}<input aria-label={t("远程目录")} value={draft} onChange={e => { draftVersion.current++; setDraft(e.target.value); }} maxLength={4096} /></label><button className="secondary-button" disabled={loading || !connected}>{t("打开目录")}</button></form>
        <div className="file-actions"><button className="quiet-button" disabled={loading || !connected} onClick={() => void load(path === '/' ? '/' : path.split('/').slice(0,-1).join('/') || '/')}>{t("上一级")}</button><button className="quiet-button" disabled={loading || !connected} onClick={() => void load(path)}>{t("刷新目录")}</button><button className="primary-button" disabled={acting || !connected} onClick={() => sessionId && void action(() => window.harbor.upload(sessionId, path))}>{t("上传文件")}</button></div>
        <p className="field-note">{t("上传同名文件不覆盖。下载完成后才替换本地目标；取消会清理部分文件。仅传输普通文件。")}</p>
        <div className="remote-files" aria-label={t("远程文件列表")} aria-busy={loading}>{entries.map(entry => <div className="remote-row" key={entry.name}><button className="file-name quiet-button" disabled={!connected || entry.kind !== 'directory' || loading} title={entry.name} onClick={() => void load(remote(entry.name))}><span aria-hidden="true">{entry.kind === 'directory' ? '▸' : entry.kind === 'link' ? '↗' : '·'}</span>{entry.name}</button><small>{entry.kind === 'directory' ? t("目录") : size(entry.size)}</small><button className="quiet-button" disabled={acting || !connected || entry.kind !== 'file'} aria-label={t("下载 {0}", entry.name)} onClick={() => sessionId && void action(() => window.harbor.download(sessionId, remote(entry.name)))}>{t("下载")}</button></div>)}{!entries.length && <p className="list-note">{loading ? t("读取目录中…") : t("目录为空，或尚未加载。")}</p>}</div>
        {!!transfers.length && <section className="transfer-list" aria-label={t("文件传输")}><h3>{t("传输记录")}</h3>{transfers.map(item => <div className="transfer-row" key={item.id}><div><strong>{item.direction === 'upload' ? '↑' : '↓'} {item.name}</strong><small>{size(item.bytes)} / {size(item.total)} · {({ running: t("传输中"), completed: t("已完成"), cancelled: t("已取消"), failed: t("失败") })[item.state]}</small>{item.state === 'running' && <progress aria-label={t("{0} 传输进度", item.name)} value={item.bytes} max={Math.max(item.total, 1)} />}{item.message && <p className="field-note">{t(item.message)}</p>}</div>{item.state === 'running' && <button className="quiet-button" onClick={() => sessionId && void action(() => window.harbor.cancelTransfer(sessionId, item.id))}>{t("取消传输")}</button>}</div>)}</section>}
      </> : <>
        <p className="dialog-intro">{t("仅监听本机 127.0.0.1，目标地址由远程服务器访问。关闭会话会停止全部转发；不自动恢复。")}</p>
        <form onSubmit={startForward}><div className="form-columns"><label>{t("本地端口")}<input required type="number" min={0} max={65535} value={localPort} onChange={e => setLocalPort(Number(e.target.value))} /></label><label>{t("远程目标端口")}<input required type="number" min={1} max={65535} value={remotePort} onChange={e => setRemotePort(Number(e.target.value))} /></label></div><label>{t("远程目标地址")}<input required maxLength={253} value={remoteHost} onChange={e => setRemoteHost(e.target.value)} /></label><p className="field-note">{t("本地端口为 0 时自动选择空闲端口。")}</p><button className="primary-button" disabled={acting || !connected}>{t("启动转发")}</button></form>
        <div className="forward-list">{forwards.map(item => <div className="forward-row" key={item.id}><code>127.0.0.1:{item.localPort}<br/>→ {item.remoteHost}:{item.remotePort}</code><button className="quiet-button danger-text" onClick={() => sessionId && void action(async () => { await window.harbor.stopForward(sessionId, item.id); await refreshForwards(); })}>{t("停止转发")}</button></div>)}{!forwards.length && <p className="list-note">{t("没有活动的本地转发。")}</p>}</div>
      </>}
      {error && <p className="form-error" role="alert">{t(error)}</p>}
    </Dialog>}
  </>;
}

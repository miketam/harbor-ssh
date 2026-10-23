import { useState, type FormEvent } from 'react';
import type { AuthMode, IdentityInput, IdentitySummary, SecretChange, VaultStatus } from '../shared';
import { Dialog, errorMessage } from './Dialog';
export const methodLabels: Record<AuthMode, string> = { password: '密码', privateKey: '私钥', interactive: '交互认证' };
function SecretField({ label, value, onChange }: { label: string; value: SecretChange; onChange: (value: SecretChange) => void }) {
  return <label>{label}<select aria-label={`${label}更新方式`} value={value.action} onChange={e => onChange(e.target.value === 'replace' ? { action: 'replace', value: '' } : { action: e.target.value as 'keep' | 'clear' })}>
    <option value="keep">保留原值，不回显</option><option value="replace">替换为新值</option><option value="clear">清除已保存值</option>
  </select>{value.action === 'replace' && <input type="password" autoComplete="off" aria-label={label} value={value.value} maxLength={4096} onChange={e => onChange({ action: 'replace', value: e.target.value })} />}</label>;
}
export function IdentityManager({ items, status, onRefresh, onClose }: {
  items: IdentitySummary[]; status: VaultStatus; onRefresh: () => Promise<void>; onClose: () => void;
}) {
  const [editing, setEditing] = useState<IdentityInput | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState(''), [deleting, setDeleting] = useState<IdentitySummary | null>(null);
  function start(identity?: IdentitySummary) {
    setError(''); setFileName(''); setDeleting(null);
    setEditing({ id: identity?.id, name: identity?.name ?? '', username: identity?.username ?? '', method: identity?.method ?? 'password', password: identity ? { action: 'keep' } : { action: 'replace', value: '' }, privateKey: identity ? { action: 'keep' } : { action: 'replace', value: '' }, passphrase: identity ? { action: 'keep' } : { action: 'replace', value: '' } });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || saving || importing) return;
    setSaving(true); setError('');
    try { await window.harbor.saveIdentity(editing); await onRefresh(); setEditing(null); }
    catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  return <Dialog title={editing ? editing.id ? '编辑身份' : '新增身份' : '加密身份库'} onClose={() => !saving && !importing && onClose()}>
    {editing ? <form onSubmit={save}>
      <p className="dialog-intro">身份内容加密保存。已保存的密码和私钥不会返回界面；请选择保留、替换或清除。</p>
      <label>身份名称<input autoFocus required maxLength={128} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>身份用户名<input required maxLength={128} autoComplete="off" value={editing.username} onChange={e => setEditing({ ...editing, username: e.target.value })} /></label>
      <label>身份认证方式<select aria-label="身份认证方式" value={editing.method} onChange={e => setEditing({ ...editing, method: e.target.value as AuthMode })}><option value="password">密码</option><option value="privateKey">私钥</option><option value="interactive">交互认证</option></select></label>
      {editing.method === 'password' && <><SecretField label="身份密码" value={editing.password} onChange={password => setEditing({ ...editing, password })} /><p className="field-note">可以不保存密码，连接时再输入。</p></>}
      {editing.method === 'privateKey' && <>
        <label>私钥更新方式<select aria-label="私钥更新方式" value={editing.privateKey.action === 'import' ? 'import' : editing.privateKey.action} onChange={e => { setFileName(''); setEditing({ ...editing, privateKey: e.target.value === 'replace' ? { action: 'replace', value: '' } : { action: e.target.value as 'keep' | 'clear' } }); }}>
          <option value="keep">保留原私钥，不回显</option><option value="replace">粘贴新私钥</option><option value="clear">清除原私钥</option>{editing.privateKey.action === 'import' && <option value="import">使用已选择的文件</option>}
        </select></label>
        {editing.privateKey.action === 'replace' && <label>私钥内容<textarea aria-label="私钥内容" rows={5} maxLength={65536} spellCheck={false} autoComplete="off" value={editing.privateKey.value} onChange={e => setEditing({ ...editing, privateKey: { action: 'replace', value: e.target.value } })} placeholder="粘贴 OpenSSH 或 PEM 格式私钥" /></label>}
        <button type="button" className="secondary-button" disabled={saving || importing} onClick={async () => { setImporting(true); setError(''); try { const imported = await window.harbor.importPrivateKey(); if (imported) { setEditing(current => current ? { ...current, privateKey: { action: 'import', token: imported.token } } : null); setFileName(imported.fileName); } } catch (e) { setError(errorMessage(e)); } finally { setImporting(false); } }}>{importing ? '读取私钥中…' : '从文件导入私钥'}</button>
        {fileName && <p className="field-note">已选择：{fileName}，私钥内容不会回传界面。</p>}
        <SecretField label="私钥 passphrase" value={editing.passphrase} onChange={passphrase => setEditing({ ...editing, passphrase })} />
        <p className="field-note">加密私钥可以不保存 passphrase，每次连接时输入。</p>
      </>}
      {editing.method === 'interactive' && <p className="field-note">密码、验证码等回答仅用于本次认证，不会保存在身份库。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet-button" disabled={saving || importing} onClick={() => { setEditing(null); setError(''); }}>返回身份列表</button><button className="primary-button" disabled={saving || importing}>{saving ? '保存中' : '保存身份'}</button></div>
    </form> : <>
      <p className="dialog-intro">{status.message}。身份可供多台主机复用。</p>
      {status.state === 'unavailable' && <button className="secondary-button" onClick={async () => { setError(''); await window.harbor.unlockVault(); await onRefresh(); }}>重试解锁身份库</button>}
      <div className="identity-list">{items.map(identity => <div className="identity-row" key={identity.id}><div><strong>{identity.name}</strong><span>{identity.username} · {methodLabels[identity.method]}</span><small>{identity.method === 'password' ? identity.hasPassword ? '已保存加密密码' : '连接时输入密码' : identity.method === 'privateKey' ? identity.hasPassphrase ? '私钥与 passphrase 均已加密' : identity.requiresPassphrase ? '连接时输入 passphrase' : '私钥已加密保存' : '回答不保存'}</small></div><div><button className="quiet-button" onClick={() => start(identity)}>编辑</button><button className="quiet-button danger-text" onClick={() => setDeleting(identity)}>删除</button></div></div>)}</div>
      {!items.length && <p className="list-note">还没有身份。新增一个身份，再在主机设置中关联。</p>}
      {deleting && <div className="forget-confirm"><p>确认删除身份「{deleting.name}」？被主机引用的身份需先解除关联。</p><button className="quiet-button" onClick={() => setDeleting(null)}>取消</button><button className="danger-button" onClick={async () => { try { await window.harbor.deleteIdentity(deleting.id); await onRefresh(); setDeleting(null); } catch (e) { setError(errorMessage(e)); } }}>确认删除身份</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="primary-button" disabled={status.state === 'unavailable'} onClick={() => start()}>新增身份</button></div>
    </>}
  </Dialog>;
}

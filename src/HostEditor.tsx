import { t, useLocale } from './i18n';
import { useState, type FormEvent } from 'react';
import type { Host, HostInput, IdentitySummary } from '../shared';
import { Dialog, errorMessage } from './Dialog';
export function HostEditor({ initial, identities, hosts, onSaved, onClose }: {
  initial: HostInput & { id?: string }; identities: IdentitySummary[]; hosts: Host[]; onSaved: (host: Host) => Promise<void>; onClose: () => void;
}) {
  useLocale();
  const [value, setValue] = useState(initial), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { const host = await window.harbor.saveHost(value); await onSaved(host); }
    catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  return <Dialog title={value.id ? t("编辑主机") : t("新增主机")} onClose={() => !saving && onClose()}><form onSubmit={save}>
    <p className="dialog-intro">{value.id ? t("可直接修改主机信息。已建立的会话保持原连接，修改在下次连接时生效。") : t("选择已保存的加密身份，或在连接时临时输入认证信息。")}</p>
    <label>{t("主机名称")}<input autoFocus required maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} placeholder={t("例如：开发服务器")} /></label>
    <label>{t("服务器地址")}<input required maxLength={253} value={value.address} onChange={e => setValue({ ...value, address: e.target.value })} placeholder={t("IP 地址或域名")} /></label>
    <label>{t("认证身份")}<select aria-label={t("认证身份")} value={value.identityId ?? ''} onChange={e => setValue({ ...value, identityId: e.target.value || null, authMode: e.target.value ? identities.find(i => i.id === e.target.value)?.method ?? 'password' : 'password' })}>
      <option value="">{t("临时认证，不保存秘密")}</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name} · {identity.username}</option>)}
      {value.identityId && !identities.some(i => i.id === value.identityId) && <option value={value.identityId}>{t("已关联身份，身份库未解锁")}</option>}
    </select></label>
    {!value.identityId && <label>{t("认证方式")}<select aria-label={t("认证方式")} value={value.authMode ?? 'password'} onChange={e => setValue({ ...value, authMode: e.target.value as 'password' | 'interactive' })}><option value="password">{t("密码")}</option><option value="interactive">{t("交互认证")}</option></select></label>}
    <div className="form-columns"><label>{t("用户名")}<input required={!value.identityId} disabled={!!value.identityId} maxLength={128} value={value.identityId ? identities.find(i => i.id === value.identityId)?.username ?? '' : value.username} onChange={e => setValue({ ...value, username: e.target.value })} autoComplete="off" placeholder={value.identityId ? t("从加密身份读取") : t("远程登录用户")} /></label><label>{t("端口")}<input required type="number" min={1} max={65535} value={value.port} onChange={e => setValue({ ...value, port: Number(e.target.value) })} /></label></div>
    {value.identityId && <p className="field-note">{t("用户名来自加密身份；修改用户名请在身份库编辑该身份，或选择另一个身份。")}</p>}
    <label>{t("跳板机")}<select aria-label={t("跳板机")} value={value.jumpHostId ?? ''} onChange={e => setValue({ ...value, jumpHostId: e.target.value || null })}><option value="">{t("直接连接")}</option>{hosts.filter(h => h.id !== value.id && !h.jumpHostId).map(h => <option key={h.id} value={h.id}>{h.name} · {h.address}</option>)}</select></label>
    <p className="field-note">{t("仅支持单跳；跳板机和目标主机分别使用自己的身份与信任记录。")}</p>
    <label>{t("分组")}<small>{t("可选")}</small><input maxLength={60} value={value.group} onChange={e => setValue({ ...value, group: e.target.value })} placeholder={t("例如：开发环境")} /></label>
    {error && <p className="form-error" role="alert">{t(error)}</p>}<div className="dialog-actions"><button type="button" className="quiet-button" disabled={saving} onClick={onClose}>{t("取消")}</button><button className="primary-button" disabled={saving}>{saving ? t("保存中") : t("保存主机")}</button></div>
  </form></Dialog>;
}

import { t, useLocale } from './i18n';
import { useState, type FormEvent } from 'react';
import type { Host, IdentitySummary } from '../shared';
import { Dialog, errorMessage } from './Dialog';
import { methodLabels } from './IdentityManager';
export interface ConnectionSecrets { password?: string; passphrase?: string; jumpPassword?: string; jumpPassphrase?: string; remember?: boolean }
export function ConnectionDialog({ host, identity, jumpHost, jumpIdentity, onConnect, onClose }: {
  host: Host; identity?: IdentitySummary; jumpHost?: Host; jumpIdentity?: IdentitySummary;
  onConnect: (temporary: ConnectionSecrets) => Promise<void>; onClose: () => void;
}) {
  useLocale();
  const [secret, setSecret] = useState(''), [jumpSecret, setJumpSecret] = useState(''), [remember, setRemember] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const method = identity?.method ?? host.authMode ?? 'password';
  const saved = method === 'password' ? identity?.hasPassword : identity?.hasPassphrase;
  const needsSecret = method === 'password' ? !saved : method === 'privateKey' && identity?.requiresPassphrase && !saved;
  const jumpMethod = jumpIdentity?.method ?? jumpHost?.authMode ?? 'password';
  const jumpNeedsSecret = !!jumpHost && (jumpMethod === 'password' ? !jumpIdentity?.hasPassword : jumpMethod === 'privateKey' && jumpIdentity?.requiresPassphrase && !jumpIdentity?.hasPassphrase);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); let value = secret, jumpValue = jumpSecret; setSecret(''); setJumpSecret('');
    try { await onConnect({ ...(needsSecret ? method === 'privateKey' ? { passphrase: value } : { password: value } : {}), ...(jumpNeedsSecret ? jumpMethod === 'privateKey' ? { jumpPassphrase: jumpValue } : { jumpPassword: jumpValue } : {}), remember: needsSecret && remember }); }
    catch (e) { setError(errorMessage(e)); } finally { value = ''; jumpValue = ''; setSaving(false); }
  }
  const locked = (!!host.identityId && !identity) || (!!jumpHost?.identityId && !jumpIdentity);
  return <Dialog title={t("连接主机")} onClose={() => !saving && onClose()}><form onSubmit={submit}>
    <p className="dialog-intro">{host.name}<br/><code>{identity?.username ?? host.username}@{host.address}:{host.port}</code><br/>{identity ? t("加密身份：{0}", identity.name) : t("临时认证")} · {t(methodLabels[method])}</p>
    {locked && <p className="form-error">{t("关联身份尚未解锁，请先在身份库恢复访问。")}</p>}
    {needsSecret && <><label>{method === 'privateKey' ? t("私钥 passphrase") : t("临时密码")}<input autoFocus type="password" required autoComplete="off" maxLength={4096} value={secret} onChange={e => setSecret(e.target.value)} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{method === 'privateKey' ? t("保存 passphrase，下次连接复用") : t("保存密码，下次连接复用")}</label></>}
    <p className="field-note">{method === 'interactive' ? t("服务器的密码或验证码问题会在连接后显示，回答不保存。") : needsSecret ? remember ? t("连接前加密保存并关联身份；若认证失败，可编辑身份纠正。") : t("未勾选保存时，输入只用于当前会话。") : t("将复用已保存的加密身份，秘密不会在界面回显。")}</p>
    {needsSecret && remember && identity && <p className="field-note">{t("将更新身份「{0}」，引用它的其他主机也会使用此值。", identity.name)}</p>}
    {jumpHost && <fieldset className="jump-auth"><legend>{t("经跳板机：{0}", jumpHost.name)}</legend><p className="field-note">{jumpIdentity?.username ?? jumpHost.username}@{jumpHost.address}:{jumpHost.port} · {t(methodLabels[jumpMethod])}{t("。两台服务器分别校验指纹。")}</p>{jumpNeedsSecret ? <label>{jumpMethod === 'privateKey' ? t("跳板机 passphrase") : t("跳板机临时密码")}<input type="password" required autoComplete="off" maxLength={4096} value={jumpSecret} onChange={e => setJumpSecret(e.target.value)} /></label> : <p className="field-note">{jumpMethod === 'interactive' ? t("跳板机将请求交互认证。") : t("使用跳板机保存的身份。")}</p>}<p className="field-note">{t("跳板机临时输入不保存；可先直接连接跳板机并勾选保存。")}</p></fieldset>}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    <div className="dialog-actions"><button type="button" className="quiet-button" disabled={saving} onClick={onClose}>{t("取消")}</button><button className="primary-button" disabled={saving || locked}>{saving ? t("连接中") : remember && needsSecret ? t("保存并连接") : t("开始连接")}</button></div>
  </form></Dialog>;
}

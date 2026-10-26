import { useState } from 'react';
import type { Host } from '../shared';
import { t } from './i18n';
import type { UITab } from './SessionPane';
export function HostBrowser({ hosts, selected, tabs, username, search, onSearch, onSelect, onConnect, onEdit, onAdd }: {
  hosts: Host[]; selected: Host | null; tabs: UITab[]; username: (host: Host) => string; search: string;
  onSearch: (value: string) => void; onSelect: (id: string) => void; onConnect: (host: Host) => void; onEdit: (host: Host) => void; onAdd: () => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const groups = [...new Set(hosts.map(host => host.group))];
  const activeGroup = group !== null && groups.includes(group) ? group : null;
  const visible = activeGroup === null ? hosts : hosts.filter(host => host.group === activeGroup);
  return <section className="host-browser" aria-label={t('主机管理')}>
    <div className="host-browser-list"><header><h2>{t('主机')}</h2><button className="primary-button" onClick={onAdd}>{t('＋ 新增主机')}</button></header>
      <input aria-label={t('搜索主机')} placeholder={t('搜索名称、地址或分组')} value={search} onChange={e => onSearch(e.target.value)}/>
      <div className="group-filters" role="group" aria-label={t('分组')}>
        <button aria-pressed={activeGroup === null} onClick={() => setGroup(null)}>{t('全部主机')}</button>
        {groups.map(name => <button key={name} aria-pressed={activeGroup === name} onClick={() => setGroup(name)}>{name || t('未分组')}</button>)}
      </div>
      <div className="host-table-scroll"><table className="host-table"><thead><tr><th>{t('主机名称')}</th><th>{t('服务器地址')}</th><th>{t('用户名')}</th><th>{t('分组')}</th></tr></thead>
      <tbody>{visible.map(host => <tr key={host.id} className={selected?.id === host.id ? 'selected' : ''}>
        <td><button onClick={() => onSelect(host.id)} onDoubleClick={() => onConnect(host)}><span className={'status-dot ' + (tabs.some(tab => tab.hostId === host.id && tab.state === 'connected') ? 'connected' : '')}/>{host.name}</button></td><td>{host.address}</td><td>{username(host)}</td><td>{host.group || t('未分组')}</td>
      </tr>)}</tbody></table></div>{!hosts.length && <p className="list-note">{t('没有匹配的主机。')}</p>}
    </div>
    <aside className="host-inspector">{selected ? <><h2>{selected.name}</h2><dl>
      <dt>{t('服务器地址')}</dt><dd>{selected.address}</dd><dt>{t('端口')}</dt><dd>{selected.port}</dd>
      <dt>{t('用户名')}</dt><dd>{username(selected)}</dd><dt>{t('分组')}</dt><dd>{selected.group || t('未分组')}</dd>
      <dt>{t('认证方式')}</dt><dd>{selected.identityId ? t('加密身份') : selected.authMode === 'password' ? t('密码') : t('私钥')}</dd>
    </dl><div className="inspector-actions"><button className="primary-button" onClick={() => onConnect(selected)}>{t('连接主机')}</button><button className="secondary-button" onClick={() => onEdit(selected)}>{t('编辑')}</button></div></> : <p className="list-note">{t('选择主机查看详情')}</p>}</aside>
  </section>;
}

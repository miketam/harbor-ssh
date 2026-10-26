import { useState } from 'react';
import type { Host } from '../shared';
import { Dialog } from './Dialog';
import { t } from './i18n';
export function HostSwitcher({ hosts, onSelect, onClose }: { hosts: Host[]; onSelect: (host: Host) => void; onClose: () => void }) {
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0);
  const matches = hosts.filter(host => [host.name, host.address, host.group].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <Dialog title={t('切换主机')} onClose={onClose}>
    <input autoFocus aria-label={t('搜索主机')} placeholder={t('搜索名称、地址或分组')} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(current => Math.max(0, Math.min(matches.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)))); }
      if (e.key === 'Enter' && matches[index]) { e.preventDefault(); onSelect(matches[index]); }
    }}/>
    <div className="switcher-results">{matches.map((host, i) => <button key={host.id} className={index === i ? 'selected' : ''} onClick={() => onSelect(host)} onFocus={() => setIndex(i)}><strong>{host.name}</strong><small>{host.address}</small></button>)}</div>
    {!matches.length && <p className="list-note">{t('没有匹配的主机。')}</p>}
    <p className="field-note">{t('↑↓ 选择 · Enter 打开 · Esc 关闭')}</p>
  </Dialog>;
}

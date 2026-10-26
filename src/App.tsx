import { setLocale, t, useLocale } from './i18n';
import { createRef, useCallback, useEffect, useRef, useState } from 'react';
import type { Host, HostInput, IdentitySummary, KnownHost, SessionEvent, UpdateCheck, VaultStatus, WorkspaceState } from '../shared';
import type { TerminalHandle } from './Terminal';
import { Dialog, errorMessage } from './Dialog';
import { HostEditor } from './HostEditor';
import { IdentityManager } from './IdentityManager';
import { ConnectionDialog, type ConnectionSecrets } from './ConnectionDialog';
import { SessionPane, type UITab } from './SessionPane';
import { AuthQuestion } from './AuthQuestion';
import { LayoutPicker, WelcomeLayout, layouts } from './LayoutPicker';
import { HostBrowser } from './HostBrowser';
import { HostSwitcher } from './HostSwitcher';
import type { Layout } from './appearance';
import { appearanceKey, readAppearance, themes, themeStyle } from './appearance';

const emptyHost: HostInput = { name: '', address: '', port: 22, username: '', group: '', identityId: null, authMode: 'password' };
const dismissedUpdateKey = 'harbor-ssh-dismissed-update';
type Question = Extract<SessionEvent, { type: 'hostkey' | 'interactive' }>;
export function App() {
  const locale = useLocale();
  useEffect(() => { void setLocale(locale).catch(e => setError(errorMessage(e))); }, []);
  const [appearance, setAppearance] = useState(readAppearance);
  const [settingsOpen, setSettingsOpen] = useState(false), [switcherOpen, setSwitcherOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false), [updateError, setUpdateError] = useState('');
  const [dismissedUpdate, setDismissedUpdate] = useState(() => { try { return localStorage.getItem(dismissedUpdateKey); } catch { return null; } });
  const updateRequest = useRef<Promise<UpdateCheck> | null>(null);
  const checkUpdates = useCallback(async (manual = false) => {
    if (!updateRequest.current) updateRequest.current = window.harbor.checkUpdates();
    setUpdateChecking(true); setUpdateError('');
    try { setUpdate(await updateRequest.current); }
    catch (error) { if (manual) setUpdateError(errorMessage(error)); }
    finally { updateRequest.current = null; setUpdateChecking(false); }
  }, []);
  useEffect(() => {
    if (!window.harbor) return;
    void checkUpdates();
    const timer = window.setInterval(() => void checkUpdates(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [checkUpdates]);
  function dismissUpdate() {
    if (!update) return;
    setDismissedUpdate(update.latestVersion);
    try { localStorage.setItem(dismissedUpdateKey, update.latestVersion); } catch { /* Dismissal remains effective for this session. */ }
  }
  function openUpdatePage() { void window.harbor.openUpdatePage().catch(error => setError(errorMessage(error))); }
  const [managerVisible, setManagerVisible] = useState(true);
  const sidebarHidden = appearance.sidebarCollapsed;
  const browsing = appearance.layout === 'manager' && managerVisible;
  function changeLayout(layout: Layout) {
    setAppearance(previous => ({ ...previous, layout, layoutChosen: true, sidebarCollapsed: layout === 'focus' }));
    setManagerVisible(layout === 'manager');
  }
  const theme = themes.find(item => item.id === appearance.themeId) ?? themes[0];
  useEffect(() => {
    try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); }
    catch { /* Appearance remains usable when local storage is unavailable. */ }
  }, [appearance]);
  const [hosts, setHosts] = useState<Host[]>([]), [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [vault, setVault] = useState<VaultStatus>({ state: 'new', message: '首次保存身份时创建加密身份库' });
  const [tabs, setTabs] = useState<UITab[]>([]), [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [search, setSearch] = useState('');
  const [editor, setEditor] = useState<(HostInput & { id?: string }) | null>(null), [identityOpen, setIdentityOpen] = useState(false);
  const [connecting, setConnecting] = useState<{ tabId: string; host: Host } | null>(null);
  const [known, setKnown] = useState<KnownHost[] | null>(null), [forgetTarget, setForgetTarget] = useState<KnownHost | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Host | null>(null), [closeTarget, setCloseTarget] = useState<UITab | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]), [error, setError] = useState(''), [savingTrust, setSavingTrust] = useState(false);
  const tabsRef = useRef<UITab[]>([]), selectedRef = useRef<string | null>(null), activeRef = useRef<string | null>(null);
  const handles = useRef(new Map<string, React.RefObject<TerminalHandle | null>>());
  const ready = useRef(false);
  const selected = hosts.find(h => h.id === selectedId) ?? null;
  const activeTab = tabs.find(t => t.id === activeId);
  const tabHost = hosts.find(h => h.id === activeTab?.hostId);
  const shown = tabHost ?? selected;
  const busy = activeTab?.state === 'connecting' || activeTab?.state === 'connected';
  const question = questions[0];
  const modalOpen = settingsOpen || switcherOpen || !appearance.layoutChosen || !!(editor || identityOpen || connecting || known || deleteTarget || closeTarget || question);
  function handleFor(id: string) {
    if (!handles.current.has(id)) handles.current.set(id, createRef<TerminalHandle>());
    return handles.current.get(id)!;
  }
  function replaceTabs(next: UITab[]) { tabsRef.current = next; setTabs(next); }
  function selectHost(id: string | null) { selectedRef.current = id; setSelectedId(id); }
  function selectTab(id: string | null) { activeRef.current = id; setActiveId(id); }
  function persist() {
    if (!ready.current) return;
    const workspace: WorkspaceState = { tabs: tabsRef.current.map(({ id, hostId }) => ({ id, hostId })), activeTabId: activeRef.current, selectedHostId: selectedRef.current };
    void window.harbor.saveWorkspace(workspace).catch(e => setError(errorMessage(e)));
  }
  const refreshIdentities = useCallback(async () => {
    try { setIdentities(await window.harbor.listIdentities()); }
    catch (e) { setIdentities([]); setVault({ state: 'unavailable', message: errorMessage(e) }); return; }
    setVault(await window.harbor.vaultStatus());
  }, []);
  useEffect(() => {
    if (!window.harbor) { setError('请通过 Electron 启动桌面应用：npm run dev'); return; }
    let live = true;
    Promise.all([window.harbor.listHosts(), window.harbor.getWorkspace()]).then(([items, workspace]) => {
      if (!live) return;
      setHosts(items);
      replaceTabs(workspace.tabs.map(tab => ({ ...tab, sessionId: null, state: 'idle', error: '', generation: 0 })));
      selectTab(workspace.activeTabId); selectHost(workspace.selectedHostId ?? items[0]?.id ?? null); ready.current = true;
    }).catch(e => setError(errorMessage(e)));
    void refreshIdentities();
    const unsubscribe = window.harbor.onSession(event => {
      if (event.type === 'data' || event.type === 'transfer' || event.type === 'forwards') return;
      const current = tabsRef.current.find(tab => tab.id === event.tabId);
      if (!current || (current.sessionId && current.sessionId !== event.sessionId)) return;
      if (event.type === 'hostkey' || event.type === 'interactive') {
        setQuestions(q => q.some(item => item.sessionId === event.sessionId && (event.type === 'hostkey' ? item.type === 'hostkey' && item.hostId === event.hostId : item.type === 'interactive' && item.requestId === event.requestId)) ? q : [...q, event]); return;
      }
      replaceTabs(tabsRef.current.map(tab => tab.id !== event.tabId ? tab : {
        ...tab, sessionId: event.sessionId,
        ...(event.type === 'status' ? { state: event.state, sessionHost: event.host ?? tab.sessionHost } : { error: event.message })
      }));
      if (event.type === 'status' && event.state === 'disconnected') setQuestions(q => q.filter(item => item.sessionId !== event.sessionId));
    });
    return () => { live = false; unsubscribe(); };
  }, [refreshIdentities]);
  useEffect(() => { if (activeId) document.getElementById(`tab-${activeId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId]);
  const identityFor = (host: Host | null | undefined) => identities.find(i => i.id === host?.identityId);
  const username = (host: Host) => identityFor(host)?.username ?? (host.identityId ? t('加密身份') : host.username);
  function requestConnection(host: Host, forceNew = false) {
    setManagerVisible(false);
    let tab = !forceNew && tabsRef.current.find(t => t.id === activeRef.current && t.hostId === host.id);
    if (tab && (tab.state === 'connected' || tab.state === 'connecting')) return;
    if (!tab) {
      if (tabsRef.current.length >= 10) { setError('最多保留 10 个标签，请先关闭一个标签'); return; }
      tab = { id: crypto.randomUUID(), hostId: host.id, sessionId: null, state: 'idle', error: '', generation: 0 };
      replaceTabs([...tabsRef.current, tab]);
    }
    selectTab(tab.id); selectHost(host.id); persist(); setError(''); setConnecting({ tabId: tab.id, host });
  }
  async function connect(temporary: ConnectionSecrets) {
    if (!connecting) return;
    const { tabId, host } = connecting;
    replaceTabs(tabsRef.current.map(tab => tab.id === tabId ? { ...tab, sessionId: null, state: 'connecting', error: '', generation: tab.generation + 1, sessionHost: { ...host, username: username(host) } } : tab));
    try {
      const size = handles.current.get(tabId)?.current?.size() ?? { columns: 100, rows: 30 };
      const sessionId = await window.harbor.connect({ tabId, hostId: host.id, ...temporary, ...size });
      replaceTabs(tabsRef.current.map(tab => tab.id === tabId ? { ...tab, sessionId } : tab)); setConnecting(null);
      if (temporary.remember) { setHosts(await window.harbor.listHosts()); await refreshIdentities(); }
    } catch (e) {
      replaceTabs(tabsRef.current.map(tab => tab.id === tabId ? { ...tab, state: 'disconnected' } : tab)); throw e;
    }
  }
  async function disconnect(tab: UITab) { try { if (tab.sessionId) await window.harbor.disconnect(tab.sessionId); } catch (e) { setError(errorMessage(e)); } }
  async function closeTab(tab: UITab) {
    if (tab.sessionId) await window.harbor.disconnect(tab.sessionId);
    const next = tabsRef.current.filter(t => t.id !== tab.id); replaceTabs(next);
    if (activeRef.current === tab.id) selectTab(next[next.length - 1]?.id ?? null);
    handles.current.delete(tab.id); setCloseTarget(null); persist();
  }
  async function decide(accept: boolean) {
    if (!question || question.type !== 'hostkey' || savingTrust) return;
    setSavingTrust(true);
    try { await window.harbor.trust(question.sessionId, accept); }
    catch (e) { setError(errorMessage(e)); await window.harbor.disconnect(question.sessionId); }
    finally { setQuestions(q => q.filter(item => !(item.type === 'hostkey' && item.sessionId === question.sessionId && item.hostId === question.hostId))); setSavingTrust(false); }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !modalOpen) {
        event.preventDefault(); setSwitcherOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);
  const filtered = hosts.filter(h => [h.name, h.address, username(h), h.group].some(s => s.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const groups = [...new Set(filtered.map(h => h.group))];
  return <div className={'app-shell layout-' + appearance.layout + (sidebarHidden ? ' sidebar-collapsed' : '')} style={themeStyle(theme)}>
    <a href="#workspace" className="skip-link">{t("跳转到终端工作区")}</a>
    <aside id="host-sidebar" className="sidebar" hidden={sidebarHidden}>
      <header className="brand"><span className="brand-mark" aria-hidden="true">H<span>_</span></span><div><strong>Harbor SSH</strong></div></header>
      <div className="sidebar-actions" hidden={appearance.layout === 'manager'}><div className="section-title"><span>{t("主机")}</span><span className="count">{hosts.length.toString().padStart(2, '0')}</span></div><button className="add-button" onClick={() => setEditor({ ...emptyHost })}>{t("＋ 新增主机")}</button><label className="search"><span aria-hidden="true">⌕</span><input aria-label={t("搜索主机")} placeholder={t("搜索名称、地址或分组")} value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      {appearance.layout === 'manager' && <button className={'manager-nav ' + (browsing ? 'selected' : '')} onClick={() => setManagerVisible(true)}>{t('主机管理')}</button>}
      <nav hidden={appearance.layout === 'manager'} className="host-list" aria-label={t("保存的主机")}>{groups.map(group => <details key={group} className="host-group" open><summary>{group || t("未分组")}<span>{filtered.filter(h => h.group === group).length}</span></summary>{filtered.filter(h => h.group === group).map(host => <button key={host.id} className={'host-row ' + (host.id === selectedId ? 'selected' : '')} onClick={() => { selectHost(host.id); const existing = tabsRef.current.find(tab => tab.hostId === host.id); selectTab(existing?.id ?? null); setError(''); persist(); }} onDoubleClick={() => requestConnection(host, true)}><span className={'host-symbol ' + (tabs.some(tab => tab.hostId === host.id && tab.state === 'connected') ? 'live' : '')} aria-hidden="true"><svg width="18" height="20" viewBox="0 0 20 22" fill="none"><rect x="2" y="2" width="16" height="7" rx="1.5" stroke="currentColor"/><rect x="2" y="13" width="16" height="7" rx="1.5" stroke="currentColor"/><path d="M5 5.5h2m-2 11h2" stroke="currentColor"/></svg></span><span className="host-text"><strong>{host.name}</strong><small>{username(host)}@{host.address}</small></span><span className="host-arrow" aria-hidden="true">↗</span></button>)}</details>)}
        {!hosts.length && <p className="list-note">{t("添加第一台服务器，从这里开始连接。")}</p>}{!!hosts.length && !filtered.length && <p className="list-note">{t("没有匹配的主机。")}</p>}
      </nav>
      <footer className="sidebar-footer"><button onClick={() => setIdentityOpen(true)}><span aria-hidden="true">▣</span>{t("加密身份库")}<span aria-hidden="true">↗</span></button><button onClick={async () => { try { setKnown(await window.harbor.listKnownHosts()); } catch (e) { setError(errorMessage(e)); } }}><span aria-hidden="true">◇</span>{t("已信任主机")}<span aria-hidden="true">↗</span></button><button onClick={() => setSettingsOpen(true)}>{t("设置")}</button><div><span className="local-dot"/>{t("本地工作区")}<span>v0.4.6</span></div></footer>
    </aside>
    <main id="workspace" className="workspace">
      <div className="workspace-controls">
        <button className="sidebar-toggle" aria-controls="host-sidebar" aria-expanded={!appearance.sidebarCollapsed} onClick={() => setAppearance(previous => ({ ...previous, sidebarCollapsed: !previous.sidebarCollapsed }))}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 3v14" stroke="currentColor" strokeWidth="1.5"/></svg>{appearance.sidebarCollapsed ? t("展开主机栏") : t("收起主机栏")}</button>
        <span className="layout-label">{t(layouts.find(item => item.id === appearance.layout)!.title)}</span>
        {appearance.layout === 'manager' && <button className="quiet-button" onClick={() => setManagerVisible(value => !value)}>{browsing ? t('返回终端') : t('主机管理')}</button>}
        <button className="quiet-button" onClick={() => setSwitcherOpen(true)}>{t('切换主机')} <kbd>⌘/Ctrl K</kbd></button>
        <button className="quiet-button" onClick={() => setSettingsOpen(true)}>{t('设置')}</button>
      </div>
      <h1 className="sr-only">{shown?.name || t("终端，准备就绪。")}</h1>
      {update?.status === 'available' && dismissedUpdate !== update.latestVersion && <div className="update-notice" role="status"><span>{t('发现新版本 v{0}', update.latestVersion)}</span><button onClick={openUpdatePage}>{t('查看发布页')}</button><button className="update-dismiss" aria-label={t('关闭更新提醒')} onClick={dismissUpdate}>×</button></div>}
      {error && <div className="error-banner" role="alert"><span>{t(error)}</span><button aria-label={t("关闭提示")} onClick={() => setError('')}>×</button></div>}
      {browsing && <HostBrowser hosts={filtered} selected={selected} tabs={tabs} username={username} search={search} onSearch={setSearch} onSelect={id => { selectHost(id); persist(); }} onConnect={requestConnection} onEdit={host => setEditor({ ...host })} onAdd={() => setEditor({ ...emptyHost })}/>}
      <section className={'terminal-panel' + (browsing ? ' browsing' : '')}><div className="terminal-toolbar"><div className="tab-strip" role="tablist" aria-label={t("终端标签")}>{tabs.length ? tabs.map(tab => <div key={tab.id} className={'tab-item ' + (tab.id === activeId ? 'active' : '')}><button role="tab" id={`tab-${tab.id}`} aria-selected={tab.id === activeId} aria-controls={`panel-${tab.id}`} tabIndex={tab.id === activeId ? 0 : -1} onKeyDown={event => { const index = tabs.findIndex(t => t.id === tab.id); if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { setManagerVisible(false); const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; selectTab(next.id); selectHost(next.hostId); persist(); document.getElementById(`tab-${next.id}`)?.focus(); event.preventDefault(); } }} onClick={() => { setManagerVisible(false); selectTab(tab.id); selectHost(tab.hostId); persist(); }}><span className={'status-dot ' + tab.state}/>{hosts.find(h => h.id === tab.hostId)?.name || t("主机已删除")}</button><button className="close-tab" aria-label={t("关闭标签 {0}", hosts.find(h => h.id === tab.hostId)?.name ?? tab.id)} onClick={() => { if (tab.state === 'connected' || tab.state === 'connecting') setCloseTarget(tab); else void closeTab(tab).catch(e => setError(errorMessage(e))); }}>×</button></div>) : <div className="terminal-tab"><span className="status-dot"/>Terminal<small>SSH</small></div>}</div><span className="terminal-kind">{tabs.length}/10</span><div className="host-actions" role="toolbar" aria-label={t("主机与连接操作")}>{shown && <><button className="quiet-button" onClick={() => setEditor({ ...shown })}>{t("编辑")}</button><button className="quiet-button danger-text" onClick={() => setDeleteTarget(shown)}>{t("删除")}</button></>}{shown && <button className="quiet-button" onClick={() => requestConnection(shown, true)}>{t("新标签")}</button>}
          {busy && activeTab ? <button className="disconnect-button" onClick={() => void disconnect(activeTab)}>{activeTab.state === 'connecting' ? t("取消连接") : t("断开连接")} <span aria-hidden="true">↙</span></button> : <button className="primary-button" disabled={!shown} onClick={() => shown && requestConnection(shown)}>{t("连接主机")}<span aria-hidden="true">↗</span></button>}</div></div>
        {tabs.map(tab => <SessionPane theme={theme.terminal} key={tab.id} tab={tab} host={tab.sessionHost ?? hosts.find(h => h.id === tab.hostId)} configurationChanged={!!tab.sessionHost && ['address','port','identityId','jumpHostId','authMode',...(!tab.sessionHost.identityId ? ['username'] : [])].some(key => tab.sessionHost?.[key as keyof Host] !== hosts.find(h => h.id === tab.hostId)?.[key as keyof Host])} active={tab.id === activeId && !browsing} focusEnabled={!modalOpen && !browsing} handle={handleFor(tab.id)} />)}
        {!activeTab && !browsing && <><div className="terminal-stage"><div className="terminal-empty"><span className="prompt-glyph" aria-hidden="true">&gt;_</span><h2>{t("你的下一次连接，从这里开始")}</h2><p>{t("主机、加密身份与标签会在此设备恢复。")}</p>{!selected && <button className="empty-add" onClick={() => setEditor({ ...emptyHost })}>{t("新增主机 ↗")}</button>}</div></div><footer className="terminal-status"><span><span className="status-dot"/>{t("未连接")}</span><span>UTF-8 <i>·</i>{t("⌘C 复制 · ⌘V 粘贴")}</span></footer></>}
      </section>

    </main>
    {!appearance.layoutChosen && <WelcomeLayout onDone={changeLayout}/>}
    {settingsOpen && <Dialog title={t('设置')} onClose={() => setSettingsOpen(false)}>
      <h3>{t('工作区布局')}</h3><p className="dialog-intro">{t('切换布局会保留当前连接和终端内容。')}</p>
      <LayoutPicker value={appearance.layout} onChange={changeLayout}/>
      <div className="settings-fields">
        <label className="language-picker">{t('语言')}<select aria-label={t('语言')} value={locale} onChange={e => { void setLocale(e.target.value as 'zh-CN' | 'en-US').catch(error => setError(errorMessage(error))); }}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label>
      </div>
      <details className="terminal-settings">
        <summary>{t('Terminal 设置')}</summary>
        <div className="settings-fields">
        <label>{t('主题')}<select aria-label={t('主题')} value={appearance.themeId} onChange={e => setAppearance(previous => ({ ...previous, themeId: e.target.value }))}>{themes.map(item => <option key={item.id} value={item.id}>{t(item.name)}</option>)}</select></label>
        </div>
      </details>
      <section className="system-update" aria-label={t('系统更新')}>
        <h3>{t('系统更新')}</h3>
        <div className="system-update-row"><div aria-live="polite">
          <strong>{update?.status === 'available' ? t('发现新版本 v{0}', update.latestVersion) : update?.status === 'unsupported' ? t('v{0} 已发布，当前设备暂无安装包', update.latestVersion) : update?.status === 'up-to-date' ? t('已是最新版本') : updateChecking ? t('正在检查更新…') : t('尚未检查更新')}</strong>
          <small>{t('当前版本 v{0}', update?.currentVersion ?? '0.4.6')}</small>
          {updateError && <small className="update-error">{t(updateError)}</small>}
        </div><button className="secondary-button" disabled={updateChecking} onClick={() => void checkUpdates(true)}>{updateChecking ? t('检查中…') : t('检查更新')}</button></div>
        {update && update.status !== 'up-to-date' && <button className="update-release" onClick={openUpdatePage}>{t('查看发布页')} ↗</button>}
        <p>{t('启动时自动检查，运行期间每 6 小时检查一次。下载和安装由你决定。')}</p>
      </section>
      <div className="dialog-actions"><button className="primary-button" onClick={() => setSettingsOpen(false)}>{t('完成')}</button></div>
    </Dialog>}
    {switcherOpen && <HostSwitcher hosts={hosts} onClose={() => setSwitcherOpen(false)} onSelect={host => {
      setSwitcherOpen(false); setManagerVisible(false); selectHost(host.id);
      const existing = tabsRef.current.find(tab => tab.hostId === host.id && (tab.state === 'connected' || tab.state === 'connecting'));
      if (existing) { selectTab(existing.id); persist(); } else requestConnection(host);
    }}/>}
    {editor && <HostEditor initial={editor} identities={identities} hosts={hosts} onClose={() => setEditor(null)} onSaved={async host => { setHosts(await window.harbor.listHosts()); selectHost(host.id); if (!tabsRef.current.some(tab => tab.id === activeRef.current && tab.hostId === host.id)) selectTab(null); setEditor(null); setError(''); persist(); }} />}
    {identityOpen && <IdentityManager items={identities} status={vault} onRefresh={refreshIdentities} onClose={() => setIdentityOpen(false)} />}
    {connecting && <ConnectionDialog key={connecting.tabId} host={connecting.host} identity={identityFor(connecting.host)} jumpHost={hosts.find(h => h.id === connecting.host.jumpHostId)} jumpIdentity={identityFor(hosts.find(h => h.id === connecting.host.jumpHostId))} onClose={() => setConnecting(null)} onConnect={connect} />}
    {question?.type === 'interactive' && <AuthQuestion key={question.requestId} question={question} hostName={question.hostName ?? t("当前主机")} onDone={() => setQuestions(q => q.filter(item => item.type !== 'interactive' || item.requestId !== question.requestId))} />}
    {question?.type === 'hostkey' && <Dialog key={question.sessionId} title={t("确认服务器身份")} onClose={() => void decide(false)}><div className="trust-badge">{hosts.find(h => h.id === question.hostId)?.name ?? t("首次连接")}</div><p className="dialog-intro">{t("请通过可信渠道核对服务器指纹。确认后，将在此设备保存信任记录。")}</p><dl className="fingerprint-detail"><dt>{t("服务器")}</dt><dd>{question.address}:{question.port}</dd><dt>{t("SHA-256 指纹")}</dt><dd className="fingerprint">{question.fingerprint}</dd></dl><div className="dialog-actions"><button className="quiet-button" disabled={savingTrust} onClick={() => void decide(false)}>{t("取消连接")}</button><button className="primary-button" disabled={savingTrust} onClick={() => void decide(true)}>{t("信任并连接")}</button></div></Dialog>}
    {closeTarget && <Dialog title={t("关闭会话标签")} onClose={() => setCloseTarget(null)}><p className="dialog-intro">{t("此标签仍有会话。关闭会断开连接，并移除重启恢复记录。")}</p><div className="dialog-actions"><button className="quiet-button" onClick={() => setCloseTarget(null)}>{t("取消")}</button><button className="danger-button" onClick={() => void closeTab(closeTarget).catch(e => setError(errorMessage(e)))}>{t("断开并关闭")}</button></div></Dialog>}
    {deleteTarget && <Dialog title={t("删除主机")} onClose={() => setDeleteTarget(null)}><p className="dialog-intro">{t("删除「{0}」的连接信息与标签？公钥信任记录会保留。", deleteTarget.name)}</p><div className="dialog-actions"><button className="quiet-button" onClick={() => setDeleteTarget(null)}>{t("取消")}</button><button className="danger-button" onClick={async () => { try { await window.harbor.deleteHost(deleteTarget.id); const next = tabsRef.current.filter(tab => tab.hostId !== deleteTarget.id); replaceTabs(next); if (!next.some(tab => tab.id === activeRef.current)) selectTab(next[0]?.id ?? null); const items = await window.harbor.listHosts(); setHosts(items); selectHost(items[0]?.id ?? null); setDeleteTarget(null); persist(); } catch (e) { setError(errorMessage(e)); setDeleteTarget(null); } }}>{t("删除主机")}</button></div></Dialog>}
    {known && <Dialog title={t("已信任主机")} onClose={() => { setKnown(null); setForgetTarget(null); }}><p className="dialog-intro">{t("服务器公钥变化时会阻断连接。核实后，可移除旧指纹，下次连接时重新确认。")}</p><div className="known-list">{known.length ? known.map(item => <div className="known-row" key={item.address + ':' + item.port}><div><strong>{item.address}:{item.port}</strong><code>{item.fingerprint}</code><small>{t("信任于 {0}", new Date(item.trustedAt).toLocaleString(locale))}</small></div><button className="quiet-button danger-text" onClick={() => setForgetTarget(item)}>{t("移除信任")}</button></div>) : <p className="list-note">{t("尚未保存主机指纹。")}</p>}</div>{forgetTarget && <div className="forget-confirm"><p>{t("确认移除 {0}:{1} 的指纹？", forgetTarget.address, forgetTarget.port)}</p><button className="quiet-button" onClick={() => setForgetTarget(null)}>{t("取消")}</button><button className="danger-button" onClick={async () => { try { await window.harbor.forgetKnownHost(forgetTarget.address, forgetTarget.port); setKnown(await window.harbor.listKnownHosts()); setForgetTarget(null); } catch (e) { setError(errorMessage(e)); setKnown(null); setForgetTarget(null); } }}>{t("确认移除")}</button></div>}</Dialog>}
  </div>;
}

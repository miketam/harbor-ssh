import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { TerminalView, type TerminalHandle } from './Terminal';
import { SessionTools } from './SessionTools';
import type { Host } from '../shared';
import type { ITheme } from '@xterm/xterm';
export interface UITab { id: string; hostId: string; sessionId: string | null; state: 'idle' | 'connecting' | 'connected' | 'disconnected'; error: string; generation: number; sessionHost?: Host }
export function SessionPane({ tab, host, active, focusEnabled, handle, configurationChanged, theme }: {
  theme: ITheme; tab: UITab; host?: Host; active: boolean; focusEnabled: boolean; handle: RefObject<TerminalHandle | null>; configurationChanged?: boolean;
}) {
  const currentSession = useRef(tab.sessionId); currentSession.current = tab.sessionId;
  const getSessionId = useCallback(() => currentSession.current, []);
  const [hadOutput, setHadOutput] = useState(false);
  useEffect(() => { handle.current?.clear(); setHadOutput(false); }, [tab.generation, handle]);
  useEffect(() => window.harbor.onSession(event => {
    if (event.tabId !== tab.id || event.type !== 'data') return;
    if (currentSession.current && currentSession.current !== event.sessionId) return;
    setHadOutput(true); handle.current?.write(event);
  }), [tab.id, handle]);
  useEffect(() => {
    if (active && focusEnabled && tab.state === 'connected') {
      const timer = setTimeout(() => handle.current?.focus(), 0); return () => clearTimeout(timer);
    }
  }, [active, focusEnabled, tab.state, handle]);
  return <div className="terminal-pane" hidden={!active} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`}>
    <SessionTools sessionId={tab.sessionId} connected={tab.state === 'connected'} hostName={host?.name ?? '当前主机'} />
    {tab.error && <div className="session-error" role="alert">{tab.error}</div>}
    <div className="terminal-stage"><TerminalView theme={theme} handle={handle} getSessionId={getSessionId} />
      {(tab.state === 'idle' || tab.state === 'connecting' || (tab.state === 'disconnected' && !hadOutput)) && <div className="terminal-empty"><span className="prompt-glyph" aria-hidden="true">&gt;_</span><h2>{tab.state === 'connecting' ? '正在建立连接' : tab.state === 'disconnected' ? '会话已结束' : '标签已恢复，等待连接'}</h2><p>{tab.state === 'connecting' ? '检查主机身份，完成认证后创建终端。' : '点击连接主机，启动此标签的独立会话。'}</p></div>}
    </div>
    <footer className="terminal-status"><span><span className={'status-dot ' + tab.state}/>{tab.state === 'connected' ? '已连接' : tab.state === 'connecting' ? '连接中' : tab.state === 'disconnected' ? '已断开' : '未连接'}</span>{configurationChanged && <span className="configuration-note">配置已修改，下次连接生效</span>}<span className="session-endpoint" title={host ? `${host.username}@${host.address}:${host.port}` : undefined}>{host ? `${host.username || '身份'}@${host.address}:${host.port}` : '临时认证'} <i>·</i> UTF-8</span></footer>
  </div>;
}

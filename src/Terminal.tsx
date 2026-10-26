import { t, useLocale } from './i18n';
import { useEffect, useRef } from 'react';
import { Terminal as Xterm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { SessionEvent } from '../shared';
export interface TerminalHandle { write(event: Extract<SessionEvent, { type: 'data' }>): void; clear(): void; focus(): void; size(): { columns: number; rows: number } }
export function TerminalView({ handle, getSessionId, theme }: { theme: ITheme; handle: React.RefObject<TerminalHandle | null>; getSessionId: () => string | null }) {
  useLocale();
  const instance = useRef<Xterm | null>(null);
  const initialTheme = useRef(theme);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const terminal = new Xterm({ cursorBlink: true, fontSize: 14, fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace', lineHeight: 1.35, scrollback: 3000, theme: initialTheme.current });
    instance.current = terminal;
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element.current!);
    // Explicitly decline OSC 52 clipboard writes from remote output.
    const clipboard = terminal.parser.registerOscHandler(52, () => true);
    const input = terminal.onData(data => {
      const id = getSessionId();
      if (id) for (let offset = 0; offset < data.length; offset += 32768) window.harbor.sendInput(id, data.slice(offset, offset + 32768));
    });
    const observer = new ResizeObserver(() => {
      if (!element.current?.clientWidth || !element.current.clientHeight) return;
      fit.fit(); const id = getSessionId();
      if (id) window.harbor.resize(id, Math.min(terminal.cols, 500), Math.min(terminal.rows, 200));
    });
    observer.observe(element.current!);
    handle.current = {
      write(event) { terminal.write(new Uint8Array(event.data), () => window.harbor.acknowledge(event.sessionId)); },
      clear() { terminal.reset(); }, focus() { terminal.focus(); }, size() { return { columns: Math.max(2, Math.min(terminal.cols, 500)), rows: Math.max(1, Math.min(terminal.rows, 200)) }; }
    };
    return () => { observer.disconnect(); input.dispose(); clipboard.dispose(); terminal.dispose(); instance.current = null; handle.current = null; };
  }, [handle, getSessionId]);
  useEffect(() => { if (instance.current) instance.current.options.theme = theme; }, [theme]);
  return <div className="terminal" ref={element} aria-label={t("SSH 交互终端")} />;
}

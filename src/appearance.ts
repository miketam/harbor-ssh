import type { CSSProperties } from 'react';
import type { ITheme } from '@xterm/xterm';

const harbor: ITheme = { background: '#17191b', foreground: '#d9dcd6', cursor: '#e1af64', selectionBackground: '#41403a', black: '#252729', red: '#e68a82', green: '#a9c98c', yellow: '#e1bd7c', blue: '#91b5c7', magenta: '#c6a0b1', cyan: '#91c6bd', white: '#d9dcd6', brightBlack: '#737e74', brightRed: '#ffaaa0', brightGreen: '#c5dfa9', brightYellow: '#f6d79c', brightBlue: '#b2d5e8', brightMagenta: '#e4bed0', brightCyan: '#b2e4da', brightWhite: '#f3f1eb' };
export const themes = [
  { id: 'harbor', name: 'Harbor 经典', surface: '#202326', toolbar: '#252a2c', muted: '#a5afa0', terminal: harbor },
  { id: 'one-dark', name: 'One Dark', surface: '#21252b', toolbar: '#2c313a', muted: '#abb2bf', terminal: { ...harbor, background: '#282c34', foreground: '#abb2bf', cursor: '#e5c07b', selectionBackground: '#3e4451', black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf', brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' } },
  { id: 'dracula', name: 'Dracula', surface: '#21222c', toolbar: '#343746', muted: '#bdc0d4', terminal: { ...harbor, background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' } },
  { id: 'nord', name: 'Nord', surface: '#272e39', toolbar: '#3b4252', muted: '#b6c2d2', terminal: { ...harbor, background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' } },
  { id: 'solarized-light', name: 'Solarized 浅色', surface: '#eee8d5', toolbar: '#eee8d5', muted: '#586e75', terminal: { ...harbor, background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', selectionBackground: '#e3dcc8', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' } },
  { id: 'github-light', name: 'GitHub 浅色', surface: '#eaeef2', toolbar: '#f6f8fa', muted: '#57606a', terminal: { ...harbor, background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selectionBackground: '#b6e3ff', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' } },
];
export type Appearance = { sidebarCollapsed: boolean; themeId: string };
export const appearanceKey = 'harbor.appearance';
export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey) ?? '{}');
    return { sidebarCollapsed: saved?.sidebarCollapsed === true, themeId: themes.some(theme => theme.id === saved?.themeId) ? saved.themeId : 'harbor' };
  } catch { return { sidebarCollapsed: false, themeId: 'harbor' }; }
}
export function themeStyle(theme: typeof themes[number]): CSSProperties {
  return { '--terminal-bg': theme.terminal.background, '--terminal-fg': theme.terminal.foreground, '--workspace-bg': theme.surface, '--toolbar-bg': theme.toolbar, '--workspace-muted': theme.muted, '--terminal-accent': theme.terminal.cursor } as CSSProperties;
}

import type { ITheme } from '@xterm/xterm';

/** The default "candlelit" theme: amber on near-black, warm ANSI palette. */
export const candlelit: ITheme = {
  background: '#0d0a06',
  foreground: '#ffb000',
  cursor: '#ffcc4d',
  cursorAccent: '#0d0a06',
  selectionBackground: '#5c3d0a',
  selectionForeground: '#fff1cc',
  black: '#1a140b',
  red: '#e0603a',
  green: '#b8a03a',
  yellow: '#ffb000',
  blue: '#c08a3e',
  magenta: '#d4785a',
  cyan: '#e8b86a',
  white: '#e8d5b0',
  brightBlack: '#6b5530',
  brightRed: '#ff7a50',
  brightGreen: '#d8c050',
  brightYellow: '#ffd060',
  brightBlue: '#e0a858',
  brightMagenta: '#f09878',
  brightCyan: '#ffd890',
  brightWhite: '#fff1cc',
};

export const FONT_STACK =
  '"JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

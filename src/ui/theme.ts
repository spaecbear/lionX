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

/** Green phosphor: an old monochrome monitor. Earned in play. */
export const greenPhosphor: ITheme = {
  background: '#050c05',
  foreground: '#33ff66',
  cursor: '#66ff88',
  cursorAccent: '#050c05',
  selectionBackground: '#145a24',
  selectionForeground: '#d8ffe0',
  black: '#0a140a',
  red: '#4dcc5c',
  green: '#33ff66',
  yellow: '#7dff8f',
  blue: '#29b84a',
  magenta: '#5ee67a',
  cyan: '#9dffae',
  white: '#c8ffd2',
  brightBlack: '#2a5c34',
  brightRed: '#66ff80',
  brightGreen: '#80ff99',
  brightYellow: '#a6ffb4',
  brightBlue: '#4ddc6b',
  brightMagenta: '#8cffa0',
  brightCyan: '#c0ffcb',
  brightWhite: '#eafff0',
};

/** Parchment: dark ink on warm paper, for bright rooms. Earned in play. */
export const parchment: ITheme = {
  background: '#f4ecd8',
  foreground: '#3b2a14',
  cursor: '#7a4a12',
  cursorAccent: '#f4ecd8',
  selectionBackground: '#d9c39a',
  selectionForeground: '#1f1408',
  black: '#2a1d0c',
  red: '#9a2e12',
  green: '#4f6418',
  yellow: '#7a4a12',
  blue: '#2f4f7a',
  magenta: '#7a2f5c',
  cyan: '#2f6a6a',
  white: '#6b5a40',
  brightBlack: '#8a7556',
  brightRed: '#b8401c',
  brightGreen: '#5f7a1c',
  brightYellow: '#5c3408',
  brightBlue: '#3a6296',
  brightMagenta: '#963a72',
  brightCyan: '#2f7f7f',
  brightWhite: '#1f1408',
};

/** High contrast: pure white and yellow on black. Always available. */
export const highContrast: ITheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#ffff00',
  cursorAccent: '#000000',
  selectionBackground: '#ffff00',
  selectionForeground: '#000000',
  black: '#000000',
  red: '#ff6b6b',
  green: '#7dff7d',
  yellow: '#ffff00',
  blue: '#8ab4ff',
  magenta: '#ff8aff',
  cyan: '#7fffff',
  white: '#ffffff',
  brightBlack: '#bfbfbf',
  brightRed: '#ff9b9b',
  brightGreen: '#a8ffa8',
  brightYellow: '#ffff7f',
  brightBlue: '#b0ccff',
  brightMagenta: '#ffb0ff',
  brightCyan: '#b0ffff',
  brightWhite: '#ffffff',
};

export const THEMES: Record<string, ITheme> = {
  candlelit,
  'green-phosphor': greenPhosphor,
  parchment,
  'high-contrast': highContrast,
};

/** Themes every player has from the start (accessibility is never earned). */
export const ALWAYS_AVAILABLE = ['candlelit', 'high-contrast'];

/** Each wing tints the path in the prompt (SGR codes, readable on every theme's background). */
export const WING_TINTS: Record<string, string> = {
  'apprentice-cells': '\x1b[93m',
  'reading-room': '\x1b[33m',
  bindery: '\x1b[91m',
  observatory: '\x1b[96m',
  aqueducts: '\x1b[94m',
  vault: '\x1b[95m',
  'haunted-stacks': '\x1b[92m',
  undercroft: '\x1b[37m',
  root: '\x1b[1;93m',
};

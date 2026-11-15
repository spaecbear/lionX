import { KEY } from '../terminal/keys';

export interface BarKey {
  label: string;
  /** Data sent to the terminal; `ctrl` toggles the sticky Ctrl modifier instead. */
  send: string | 'ctrl';
  /** Accessible name when the label is a symbol. */
  aria: string;
  wide?: boolean;
}

const k = (label: string, send: string | 'ctrl', aria: string, wide = false): BarKey => ({
  label,
  send,
  aria,
  wide,
});

/** First page: what beginners need most. Second page (swipe): the rest. */
export const BAR_PAGES: BarKey[][] = [
  [
    k('Tab', KEY.TAB, 'Tab', true),
    k('/', '/', 'slash'),
    k('-', '-', 'dash'),
    k('|', '|', 'pipe'),
    k('>', '>', 'greater than'),
    k('~', '~', 'tilde'),
    k('.', '.', 'dot'),
    k('*', '*', 'star'),
    k('Ctrl', 'ctrl', 'Control', true),
    k('↑', KEY.UP, 'previous command'),
    k('↓', KEY.DOWN, 'next command'),
  ],
  [
    k('←', KEY.LEFT, 'cursor left'),
    k('→', KEY.RIGHT, 'cursor right'),
    k('<', '<', 'less than'),
    k('&', '&', 'ampersand'),
    k(';', ';', 'semicolon'),
    k('$', '$', 'dollar'),
    k('"', '"', 'double quote'),
    k("'", "'", 'single quote'),
    k('?', '?', 'question mark'),
    k('_', '_', 'underscore'),
    k('=', '=', 'equals'),
    k('Esc', '\x1b', 'Escape', true),
  ],
];

/** Split raw terminal input into individual keys: escape sequences or single characters. */
export function splitKeys(data: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === '\x1b') {
      // eslint-disable-next-line no-control-regex -- terminal input is escape sequences
      const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z]|[bf\x7f])/.exec(data.slice(i));
      const len = m ? m[0].length : 1;
      keys.push(data.slice(i, i + len));
      i += len;
    } else {
      // Keep surrogate pairs (emoji) together.
      const cp = data.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      keys.push(data.slice(i, i + len));
      i += len;
    }
  }
  return keys;
}

export const KEY = {
  ENTER: '\r',
  LF: '\n',
  BACKSPACE: '\x7f',
  CTRL_H: '\b',
  DELETE: '\x1b[3~',
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  RIGHT: '\x1b[C',
  LEFT: '\x1b[D',
  HOME: ['\x1b[H', '\x1bOH', '\x1b[1~', '\x01'],
  END: ['\x1b[F', '\x1bOF', '\x1b[4~', '\x05'],
  WORD_LEFT: ['\x1b[1;5D', '\x1b[1;3D', '\x1bb'],
  WORD_RIGHT: ['\x1b[1;5C', '\x1b[1;3C', '\x1bf'],
  TAB: '\t',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_L: '\x0c',
  CTRL_U: '\x15',
  CTRL_K: '\x0b',
  CTRL_W: '\x17',
  CTRL_A: '\x01',
  CTRL_E: '\x05',
  CTRL_P: '\x10',
  CTRL_N: '\x0e',
} as const;

import type { Command } from './types';
import manPage from '../../content/grimoire/echo.txt?raw';

/** Interpret backslash escapes for `echo -e`. Returns [text, stopOutput] (\c stops output). */
function unescape(s: string): [string, boolean] {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) {
      out += s[i];
      continue;
    }
    const c = s[++i];
    const map: Record<string, string> = {
      n: '\n',
      t: '\t',
      '\\': '\\',
      a: '\x07',
      b: '\b',
      e: '\x1b',
      f: '\f',
      r: '\r',
      v: '\v',
    };
    if (c === 'c') return [out, true];
    if (c in map) out += map[c];
    else if (c === '0') {
      const m = /^[0-7]{0,3}/.exec(s.slice(i + 1))![0];
      out += String.fromCharCode(parseInt(m || '0', 8));
      i += m.length;
    } else out += '\\' + c;
  }
  return [out, false];
}

/** GNU/Bash `echo`: options -n, -e, -E, only as leading words made purely of those letters. */
export const echo: Command = {
  name: 'echo',
  unlockedInAct: 8,
  manPage,
  async run(args, io) {
    let newline = true;
    let escapes = false;
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (!/^-[neE]+$/.test(a)) break;
      for (const f of a.slice(1)) {
        if (f === 'n') newline = false;
        else if (f === 'e') escapes = true;
        else escapes = false;
      }
    }
    let text = args.slice(i).join(' ');
    if (escapes) {
      const [t, stop] = unescape(text);
      if (stop) {
        io.stdout.write(t);
        return 0;
      }
      text = t;
    }
    io.stdout.write(text + (newline ? '\n' : ''));
    return 0;
  },
};

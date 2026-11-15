import type { IO, ShellContext } from './types';
import { defineCommand, reason } from './util';

const REVERSE = '\x1b[7m';
const RESET = '\x1b[0m';

/** A tiny nano: enough to write a ritual script by hand. */
export async function editFile(path: string, io: IO, ctx: ShellContext): Promise<number> {
  const tty = io.tty!;
  let lines: string[];
  let isNew = false;
  try {
    lines = ctx.vfs.readFile(path).replace(/\n$/, '').split('\n');
  } catch (e) {
    if (reason(e) !== 'No such file or directory') {
      io.stderr.write(`nano: ${path}: ${reason(e)}\n`);
      return 1;
    }
    lines = [''];
    isNew = true;
  }
  let row = 0;
  let col = 0;
  let top = 0;
  let modified = false;
  let message = isNew
    ? '[ New File ]'
    : `[ Read ${lines.length} line${lines.length === 1 ? '' : 's'} ]`;

  const draw = () => {
    const height = Math.max(3, tty.rows - 4);
    if (row < top) top = row;
    if (row >= top + height) top = row - height + 1;
    const cols = tty.cols;
    const title = `  Lexicon nano   ${path}${modified ? '   Modified' : ''}`;
    let out = '\x1b[H\x1b[2J' + REVERSE + title.padEnd(cols).slice(0, cols) + RESET + '\r\n';
    for (let i = 0; i < height; i++) out += (lines[top + i] ?? '').slice(0, cols) + '\r\n';
    out += (message ? REVERSE + message + RESET : '') + '\r\n';
    out += `${REVERSE}^O${RESET} Write Out  ${REVERSE}^X${RESET} Exit  ${REVERSE}^K${RESET} Cut line`;
    out += `\x1b[${row - top + 2};${Math.min(col, cols - 1) + 1}H`;
    io.stdout.write(out);
  };

  /** Ask a question on the message line; returns the typed answer (or null if cancelled). */
  const ask = async (prompt: string, initial = '', single = false): Promise<string | null> => {
    let answer = initial;
    for (;;) {
      message = prompt + answer;
      draw();
      const k = await tty.readKey();
      if (k === '\x03' || k === '\x1b') return null;
      if (single && k.length === 1 && k >= ' ') return k;
      if (k === '\r' || k === '\n') return answer;
      if (k === '\x7f' || k === '\b') answer = answer.slice(0, -1);
      else if (k.length === 1 && k >= ' ') answer += k;
    }
  };

  const save = async (): Promise<boolean> => {
    const name = await ask('File Name to Write: ', path);
    if (name === null) {
      message = '[ Cancelled ]';
      return false;
    }
    try {
      ctx.vfs.writeFile(name, lines.join('\n') + '\n');
      path = name;
      modified = false;
      message = `[ Wrote ${lines.length} line${lines.length === 1 ? '' : 's'} ]`;
      return true;
    } catch (e) {
      message = `[ Error writing ${name}: ${reason(e)} ]`;
      return false;
    }
  };

  io.stdout.write('\x1b[?1049h');
  try {
    for (;;) {
      draw();
      message = '';
      const k = await tty.readKey();
      const line = lines[row];
      if (k === '\x18') {
        // Ctrl+X: exit, offering to save changes.
        if (!modified) break;
        const yn = await ask('Save modified buffer?  (Y/N) ', '', true);
        if (yn === null) continue;
        if (/y/i.test(yn)) {
          if (await save()) break;
        } else if (/n/i.test(yn)) break;
      } else if (k === '\x0f') await save();
      else if (k === '\x0b') {
        // Ctrl+K: cut the current line.
        lines.splice(row, 1);
        if (lines.length === 0) lines.push('');
        row = Math.min(row, lines.length - 1);
        col = 0;
        modified = true;
      } else if (k === '\r' || k === '\n') {
        lines.splice(row, 1, line.slice(0, col), line.slice(col));
        row++;
        col = 0;
        modified = true;
      } else if (k === '\x7f' || k === '\b') {
        if (col > 0) {
          lines[row] = line.slice(0, col - 1) + line.slice(col);
          col--;
          modified = true;
        } else if (row > 0) {
          col = lines[row - 1].length;
          lines[row - 1] += line;
          lines.splice(row, 1);
          row--;
          modified = true;
        }
      } else if (k === '\x1b[A') {
        row = Math.max(0, row - 1);
        col = Math.min(col, lines[row].length);
      } else if (k === '\x1b[B') {
        row = Math.min(lines.length - 1, row + 1);
        col = Math.min(col, lines[row].length);
      } else if (k === '\x1b[D') {
        if (col > 0) col--;
        else if (row > 0) col = lines[--row].length;
      } else if (k === '\x1b[C') {
        if (col < line.length) col++;
        else if (row < lines.length - 1) {
          row++;
          col = 0;
        }
      } else if (k === '\x01' || k === '\x1b[H') col = 0;
      else if (k === '\x05' || k === '\x1b[F') col = line.length;
      else if (k === '\t' || (k.length === 1 && k >= ' ')) {
        lines[row] = line.slice(0, col) + k + line.slice(col);
        col += k.length;
        modified = true;
      }
    }
  } finally {
    io.stdout.write('\x1b[?1049l');
  }
  return 0;
}

export const nano = defineCommand({
  name: 'nano',
  unlockedInAct: 9,
  options: {},
  async run(o, io, ctx) {
    if (!io.tty) {
      io.stderr.write('Too many errors from stdin\n');
      return 1;
    }
    const path = o.operands[0];
    if (!path) {
      io.stderr.write('nano: give the name of a file to edit, like: nano ritual.sh\n');
      return 1;
    }
    return editFile(path, io, ctx);
  },
});

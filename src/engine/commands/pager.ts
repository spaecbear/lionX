import type { IO } from './types';

export const ALT_SCREEN_ON = '\x1b[?1049h';
export const ALT_SCREEN_OFF = '\x1b[?1049l';
const REVERSE = '\x1b[7m';
const RESET = '\x1b[0m';

/** Expand tabs and wrap long lines to the screen width. */
export function wrapForScreen(text: string, cols: number): string[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const rows: string[] = [];
  for (const raw of body.split('\n')) {
    let line = '';
    for (const ch of raw) line += ch === '\t' ? ' '.repeat(8 - (line.length % 8)) : ch;
    if (line === '') rows.push('');
    for (let i = 0; i < line.length; i += cols) rows.push(line.slice(i, i + cols));
  }
  return rows;
}

const KEYS = {
  quit: ['q', 'Q', ':q', '\x03', 'ZZ'],
  pageDown: [' ', 'f', '\x06', '\x16', '\x1b[6~', 'z'],
  pageUp: ['b', '\x02', '\x1b[5~', 'w'],
  lineDown: ['j', '\r', '\n', 'e', '\x0e', '\x1b[B'],
  lineUp: ['k', 'y', '\x10', '\x0b', '\x1b[A'],
  halfDown: ['d', '\x04'],
  halfUp: ['u', '\x15'],
  top: ['g', '<', '\x1b[H'],
  bottom: ['G', '>', '\x1b[F'],
};

/**
 * A small `less`: space/f page down, b page up, j/k or arrows by line,
 * d/u half pages, g/G top and bottom, q quits. Uses the alternate screen so
 * the scrollback is left as it was. Without a terminal it just copies the
 * text through, like real less does when piped.
 */
export async function page(text: string, io: IO, title?: string): Promise<void> {
  const tty = io.tty;
  if (!tty || !io.stdoutIsTerminal) {
    io.stdout.write(text);
    return;
  }
  const height = Math.max(1, tty.rows - 1);
  let top = 0;
  io.stdout.write(ALT_SCREEN_ON);
  for (;;) {
    const lines = wrapForScreen(text, Math.max(1, tty.cols));
    const maxTop = Math.max(0, lines.length - height);
    top = Math.max(0, Math.min(top, maxTop));
    const visible = lines.slice(top, top + height);
    while (visible.length < height) visible.push('~');
    const atEnd = top >= maxTop;
    const status = atEnd ? '(END)' : top === 0 && title ? title : ':';
    io.stdout.write('\x1b[H\x1b[2J' + visible.join('\r\n') + '\r\n' + REVERSE + status + RESET);
    const key = await tty.readKey();
    if (KEYS.quit.includes(key)) break;
    if (KEYS.pageDown.includes(key)) top += height;
    else if (KEYS.pageUp.includes(key)) top -= height;
    else if (KEYS.lineDown.includes(key)) top += 1;
    else if (KEYS.lineUp.includes(key)) top -= 1;
    else if (KEYS.halfDown.includes(key)) top += Math.ceil(height / 2);
    else if (KEYS.halfUp.includes(key)) top -= Math.ceil(height / 2);
    else if (KEYS.top.includes(key)) top = 0;
    else if (KEYS.bottom.includes(key)) top = maxTop;
  }
  io.stdout.write(ALT_SCREEN_OFF);
}

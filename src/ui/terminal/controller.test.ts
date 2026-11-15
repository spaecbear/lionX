import { Terminal } from '@xterm/headless';
import { createRegistry } from '../../engine/commands';
import { Shell } from '../../engine/shell';
import { buildWorld } from '../../engine/vfs';
import { formatColumns, TerminalController, wrapText } from './controller';

/** A real xterm.js emulator (headless) so tests can read what is on screen. */
async function setup(cols = 80, opts: { history?: string[] } = {}) {
  const term = new Terminal({ cols, rows: 24, allowProposedApi: true });
  const vfs = buildWorld({
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    dirs: ['/home/apprentice/notes', '/home/apprentice/nightshade', '/atrium'],
    files: {
      '/home/apprentice/welcome.txt': 'hi\n',
      '/home/apprentice/notes/page one': 'p\n',
    },
  });
  const shell = new Shell({
    vfs,
    registry: createRegistry(),
    terminal: { stdout: { write() {} }, stderr: { write() {} } },
  });
  const pending: Promise<void>[] = [];
  const writes: string[] = [];
  const termLike = {
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    write(s: string) {
      writes.push(s);
      pending.push(new Promise<void>((r) => term.write(s, r)));
    },
  };
  const commands: string[] = [];
  const ctl = new TerminalController(termLike, shell, {
    motd: 'The Lexicon wakes.\r\n',
    history: opts.history,
    onCommand: (line) => commands.push(line),
  });
  ctl.start();
  const flush = async () => {
    await Promise.all(pending);
  };
  const type = async (data: string) => {
    await ctl.handleData(data);
    await flush();
  };
  /** Screen rows as text, trailing blank lines removed. */
  const screen = () => {
    const b = term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < b.length; y++) rows.push(b.getLine(y)!.translateToString(true));
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    return rows;
  };
  const cursor = () => {
    const b = term.buffer.active;
    return { x: b.cursorX, y: b.cursorY + b.baseY };
  };
  await flush();
  return { term, ctl, shell, vfs, type, screen, cursor, commands, writes };
}

const P = 'apprentice@archive:~$ ';

describe('TerminalController', () => {
  it('shows the motd and a Bash-style prompt', async () => {
    const { screen, cursor } = await setup();
    expect(screen()).toEqual(['The Lexicon wakes.', P]);
    expect(cursor()).toEqual({ x: P.length, y: 1 });
  });

  it('runs a command and prints its output, then a new prompt', async () => {
    const { type, screen, commands } = await setup();
    await type('echo hello\r');
    expect(screen()).toEqual(['The Lexicon wakes.', P + 'echo hello', 'hello', P]);
    expect(commands).toEqual(['echo hello']);
  });

  it('reports unknown commands like Bash', async () => {
    const { type, screen } = await setup();
    await type('lionX\r');
    expect(screen().slice(-2)).toEqual(['bash: lionX: command not found', P]);
  });

  it('edits mid-line with arrows, backspace, home/end', async () => {
    const { type, screen, ctl } = await setup();
    await type('ecoh hi');
    await type('\x1b[H\x1b[C\x1b[C\x1b[C\x7f\x1b[Co'); // home, right x3, backspace, right, o
    expect(ctl.line.text).toBe('echo hi');
    await type('\x1b[F!\r');
    expect(screen().slice(-2)).toEqual(['hi!', P]);
  });

  it('places the cursor correctly after edits', async () => {
    const { type, cursor } = await setup();
    await type('abcdef\x1b[D\x1b[D');
    expect(cursor()).toEqual({ x: P.length + 4, y: 1 });
  });

  it('recalls history with up/down and restores the draft', async () => {
    const { type, ctl, screen } = await setup(80, { history: ['echo old'] });
    await type('echo one\r');
    await type('draft\x1b[A');
    expect(ctl.line.text).toBe('echo one');
    await type('\x1b[A');
    expect(ctl.line.text).toBe('echo old');
    await type('\x1b[B\x1b[B');
    expect(ctl.line.text).toBe('draft');
    expect(screen()[screen().length - 1]).toBe(P + 'draft');
  });

  it('Ctrl+C abandons the line with ^C and sets $? to 130', async () => {
    const { type, screen, shell } = await setup();
    await type('echo nope\x03');
    expect(screen().slice(-2)).toEqual([P + 'echo nope^C', P]);
    expect(shell.lastStatus).toBe(130);
  });

  it('Ctrl+L clears the screen but keeps the current line', async () => {
    const { type, screen, cursor } = await setup();
    await type('echo a\r');
    await type('echo b\x0c');
    expect(screen()).toEqual([P + 'echo b']);
    expect(cursor().x).toBe(P.length + 6);
  });

  it('the clear command wipes the screen and the prompt lands at the top', async () => {
    const { type, screen } = await setup();
    await type('echo a\rclear\r');
    expect(screen()).toEqual([P]);
  });

  it('keeps the prompt at column 0 after output without a newline', async () => {
    const { type, screen } = await setup();
    await type('echo -n partial\r');
    expect(screen().slice(-2)).toEqual(['partial', P]);
  });

  it('tab completes commands', async () => {
    const { type, ctl } = await setup();
    await type('ec\t');
    expect(ctl.line.text).toBe('echo ');
  });

  it('tab completes paths, adding / for directories and escaping spaces', async () => {
    const { type, ctl } = await setup();
    await type('echo no\t');
    expect(ctl.line.text).toBe('echo notes/');
    await type('p\t');
    expect(ctl.line.text).toBe('echo notes/page\\ one ');
    await type('\r');
  });

  it('tab lists candidates when ambiguous and redraws the line', async () => {
    const { type, screen, ctl } = await setup();
    await type('echo n\t');
    expect(ctl.line.text).toBe('echo n');
    const s = screen();
    expect(s[s.length - 2]).toMatch(/^nightshade\/\s+notes\/$/);
    expect(s[s.length - 1]).toBe(P + 'echo n');
  });

  it('rings the bell when nothing matches', async () => {
    const { type, writes } = await setup();
    await type('echo zz\t');
    expect(writes[writes.length - 1]).toBe('\x07');
  });

  it('shows a continuation prompt for unfinished quotes and pipes', async () => {
    const { type, screen, commands } = await setup();
    await type("echo 'two\r");
    expect(screen()[screen().length - 1]).toBe('> ');
    await type("lines'\r");
    expect(screen().slice(-3)).toEqual(['two', 'lines', P]);
    expect(commands).toEqual(["echo 'two\nlines'"]);
  });

  it('reports real syntax errors instead of continuing', async () => {
    const { type, screen } = await setup();
    await type('| echo\r');
    expect(screen().slice(-2)).toEqual(["bash: syntax error near unexpected token `|'", P]);
  });

  it('updates the prompt path after cd-like changes', async () => {
    const { type, screen, vfs } = await setup();
    vfs.chdir('/atrium');
    await type('\r');
    expect(screen()[screen().length - 1]).toBe('apprentice@archive:/atrium$ ');
    vfs.chdir('~/notes');
    await type('\r');
    expect(screen()[screen().length - 1]).toBe('apprentice@archive:~/notes$ ');
  });

  it('shows # for root', async () => {
    const { type, screen, vfs } = await setup();
    vfs.credentials = { user: 'root', groups: ['root'] };
    await type('\r');
    expect(screen()[screen().length - 1]).toBe('root@archive:~# ');
  });

  it('handles lines that wrap past the terminal width', async () => {
    const { type, screen, cursor, ctl } = await setup(30);
    const long = 'echo ' + 'x'.repeat(40);
    await type(long);
    expect(ctl.line.text).toBe(long);
    // Prompt (22) + 45 chars = 67 cells -> 3 rows.
    expect(cursor()).toEqual({ x: 67 % 30, y: 1 + 2 });
    await type('\x1b[H'); // jump to start: cursor right after the prompt
    expect(cursor()).toEqual({ x: P.length, y: 1 });
    await type('\x1b[F\x7f\x7f'); // shrink back across a row boundary
    expect(cursor()).toEqual({ x: 65 % 30, y: 3 });
    const s = screen();
    expect(s.slice(1).join('')).toBe(P.trimEnd() + ' ' + long.slice(0, -2));
  });

  it('handles a line ending exactly at the right edge', async () => {
    const { type, cursor, screen } = await setup(30);
    await type('x'.repeat(30 - P.length));
    expect(cursor()).toEqual({ x: 0, y: 2 });
    await type('\x7f');
    expect(cursor()).toEqual({ x: 29, y: 1 });
    expect(screen().length).toBe(2);
  });

  it('pasted text with newlines runs each line', async () => {
    const { type, screen } = await setup();
    await type('echo a\necho b\n');
    expect(screen().filter((l) => l === 'a' || l === 'b')).toEqual(['a', 'b']);
  });

  it('ignores unknown control keys and inserts emoji', async () => {
    const { type, ctl } = await setup();
    await type('\x1b[15~\x02🦁');
    expect(ctl.line.text).toBe('🦁');
  });

  it('kill and word keys work through the controller', async () => {
    const { type, ctl } = await setup();
    await type('echo one two\x17');
    expect(ctl.line.text).toBe('echo one ');
    await type('\x01\x0b');
    expect(ctl.line.text).toBe('');
    await type('echo abc def\x1b[1;5D\x15');
    expect(ctl.line.text).toBe('def');
    await type('\x1b[1;5C\x04x\x10\x0e');
    expect(ctl.line.text).toBe('defx');
  });
});

describe('formatColumns', () => {
  it('fills down columns', () => {
    expect(formatColumns(['a', 'b', 'c', 'd', 'e'], 9)).toBe('a  c  e\r\nb  d');
  });
  it('falls back to one column when names are wide', () => {
    expect(formatColumns(['long-name', 'x'], 4)).toBe('long-name\r\nx');
  });
});

describe('TerminalController regressions', () => {
  it('motd with bare newlines starts each line at column 0', async () => {
    const term = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    const shell = new Shell({
      vfs: buildWorld({ user: { name: 'a', groups: ['a'], home: '/home/a' } }),
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
    });
    const done: Promise<void>[] = [];
    const ctl = new TerminalController(
      { cols: 40, rows: 5, write: (s) => void done.push(new Promise((r) => term.write(s, r))) },
      shell,
      { motd: 'one\ntwo\n' },
    );
    ctl.start();
    await Promise.all(done);
    const b = term.buffer.active;
    expect([0, 1].map((y) => b.getLine(y)!.translateToString(true))).toEqual(['one', 'two']);
  });

  it('recalled multi-line history shows as one line with ↵ and runs intact', async () => {
    const { type, screen, cursor } = await setup();
    await type("echo 'a\rb'\r");
    await type('\x1b[A');
    expect(screen()[screen().length - 1]).toBe(P + "echo 'a↵b'");
    expect(cursor().x).toBe(P.length + 10);
    await type('\r');
    expect(screen().slice(-3)).toEqual(['a', 'b', P]);
  });
});

describe('TerminalController mobile input', () => {
  it('normalizes smart quotes from phone keyboards before running', async () => {
    const { type, screen } = await setup();
    await type('echo “hi there”\r');
    expect(screen().slice(-2)).toEqual(['hi there', P]);
  });
});

describe('wrapText', () => {
  it.each<[string, number, string]>([
    ['the glass knows', 9, 'the glass\nknows'],
    ['a b\nc', 10, 'a b\nc'],
    ['abcdefghij', 4, 'abcd\nefgh\nij'],
    ['x abcdefgh', 4, 'x\nabcd\nefgh'],
    ['', 5, ''],
    ['keep', 0, 'keep'],
  ])('%j at %i', (text, w, want) => expect(wrapText(text, w)).toBe(want));
});

describe('TerminalController with interactive programs', () => {
  it('less takes over the screen, reads keys, and gives the prompt back', async () => {
    const { type, screen, vfs, term } = await setup(40);
    vfs.writeFile(
      'tall.txt',
      Array.from({ length: 50 }, (_, i) => `row ${i + 1}`).join('\n') + '\n',
    );
    await type('less tall.txt\r');
    expect(term.buffer.active.type).toBe('alternate');
    expect(screen()[0]).toBe('row 1');
    await type(' ');
    expect(screen()[0]).toBe('row 24');
    await type('q');
    expect(term.buffer.active.type).toBe('normal');
    expect(screen().slice(-2)).toEqual([P + 'less tall.txt', P]);
  });

  it('typing ahead while a pager runs is delivered to the pager in order', async () => {
    const { type, screen, vfs } = await setup(40);
    vfs.writeFile(
      'tall.txt',
      Array.from({ length: 50 }, (_, i) => `row ${i + 1}`).join('\n') + '\n',
    );
    await type('less tall.txt\r  qecho done\r');
    expect(screen().slice(-2)).toEqual(['done', P]);
  });

  it('ls output is laid out for the terminal width', async () => {
    const { type, screen, vfs } = await setup(40);
    for (const n of ['alpha', 'beta', 'gamma']) vfs.createFile(n);
    await type('ls\r');
    expect(screen().slice(-3)).toEqual([
      'alpha  gamma       notes',
      'beta   nightshade  welcome.txt',
      P,
    ]);
  });
});

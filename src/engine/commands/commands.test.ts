import { Shell } from '../shell';
import { LOCKED_MESSAGE } from '../shell/executor';
import { createRegistry } from '.';
import { commandCases } from './commands.cases';
import { formatDate, humanSize, layoutColumns, modeString } from './ls';
import { OptionError, parseOptions } from './options';
import { ALT_SCREEN_OFF, ALT_SCREEN_ON, wrapForScreen } from './pager';
import { run, testWorld, T_NOW } from './test-world';

describe('commands match GNU coreutils / Bash output', () => {
  it.each(commandCases)('$cmd', async ({ cmd, out, err, status }) => {
    const r = await run(cmd);
    if (out !== undefined) expect(r.out).toBe(out);
    expect(r.err).toBe(err ?? '');
    if (status !== undefined) expect(r.status).toBe(status);
  });
});

describe('ls on a terminal', () => {
  const tty = (cols: number) => ({ tty: { cols, rows: 24 } });

  it('lays names out in columns, filled top to bottom, quoting names with spaces', async () => {
    const r = await run('ls', tty(80));
    expect(r.out).toBe(
      ' big.txt      journal.txt   no-newline.txt   run.sh\n' +
        " blanks.txt   letter.txt    notes           'two words.txt'\n" +
        ' empty.txt    many          old.txt\n',
    );
  });

  it('fits the terminal width', async () => {
    const r = await run('ls many', tty(40));
    expect(r.out).toBe(
      'a      ffffff      k1      p666666\n' +
        'bb     ggggggg     l22     q7777777\n' +
        'ccc    hhhhhhhh    m333    r88888888\n' +
        'dddd   iiiiiiiii   n4444   s999999999\n' +
        'eeeee  jjjjjjjjjj  o55555  t\n',
    );
    for (const line of r.out.split('\n')) expect(line.length).toBeLessThanOrEqual(40);
  });

  it('falls back to one column when names are wider than the screen', async () => {
    expect((await run('ls notes', tty(5))).out).toBe('page1\npage2\n');
  });

  it('-1 forces one per line; -C forces columns even when piped', async () => {
    expect((await run('ls -1 notes', tty(80))).out).toBe('page1\npage2\n');
    expect((await run('ls -C notes | cat')).out).toBe('page1  page2\n');
  });

  it('--color=auto colors directories and runnable files only on a terminal', async () => {
    const r = await run('ls --color=auto -d notes run.sh', tty(80));
    expect(r.out).toBe('\x1b[0m\x1b[01;34mnotes\x1b[0m  \x1b[01;32mrun.sh\x1b[0m\n');
    expect((await run('ls --color=auto -d notes')).out).toBe('notes\n');
  });

  it('-l quotes and aligns names with spaces', async () => {
    const r = await run('ls -l letter.txt "two words.txt"', tty(80));
    expect(r.out).toBe(
      '-rw-r--r-- 1 apprentice apprentice 41 Nov 14 20:15  letter.txt\n' +
        "-rw-r--r-- 1 apprentice apprentice  7 Nov 14 20:15 'two words.txt'\n",
    );
  });

  it('uses $COLUMNS when there is no terminal', async () => {
    const vfs = testWorld();
    const shell = new Shell({
      vfs,
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      env: { COLUMNS: '20' },
    });
    const r = await run('ls -C many | head -n 1', { shell });
    expect(r.out).toBe('a\n'); // two columns would need 22 cells
  });
});

describe('ls helpers', () => {
  it('modeString', () => {
    const s = (type: 'file' | 'dir', mode: number) =>
      modeString({ type, mode } as Parameters<typeof modeString>[0]);
    expect(s('dir', 0o755)).toBe('drwxr-xr-x');
    expect(s('file', 0o640)).toBe('-rw-r-----');
    expect(s('file', 0)).toBe('----------');
  });

  it.each([
    [0, '0'],
    [1023, '1023'],
    [1024, '1.0K'],
    [1025, '1.1K'],
    [1536, '1.5K'],
    [4096, '4.0K'],
    [10239, '10K'],
    [10240, '10K'],
    [10241, '11K'],
    [1048575, '1.0M'],
    [1048576, '1.0M'],
    [5 * 1024 ** 3, '5.0G'],
  ])('humanSize(%i) = %s', (n, want) => expect(humanSize(n)).toBe(want));

  it('formatDate uses time for recent files and year for old or future ones', () => {
    expect(formatDate(Date.UTC(2026, 10, 5, 7, 3), T_NOW)).toBe('Nov  5 07:03');
    expect(formatDate(Date.UTC(2025, 0, 2), T_NOW)).toBe('Jan  2  2025');
    expect(formatDate(Date.UTC(2027, 0, 1), T_NOW)).toBe('Jan  1  2027');
  });

  it('layoutColumns handles empty input', () => {
    expect(layoutColumns([], 80)).toBe('');
  });
});

describe('pager (less and man)', () => {
  const tall = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const setup = () => {
    const vfs = testWorld();
    vfs.writeFile('tall.txt', tall);
    return vfs;
  };
  /** The text of the last screen the pager drew. */
  const lastScreen = (out: string) => {
    const screens = out.split('\x1b[H\x1b[2J');
    return screens[screens.length - 1].replace(ALT_SCREEN_OFF, '').split('\r\n');
  };

  it('shows one screen, then quits with q, restoring the screen', async () => {
    const r = await run('less tall.txt', {
      vfs: setup(),
      tty: { cols: 40, rows: 10 },
      keys: ['q'],
    });
    expect(r.out.startsWith(ALT_SCREEN_ON)).toBe(true);
    expect(r.out.endsWith(ALT_SCREEN_OFF)).toBe(true);
    const screen = lastScreen(r.out);
    expect(screen.slice(0, 9)).toEqual(Array.from({ length: 9 }, (_, i) => `line ${i + 1}`));
    expect(screen[9]).toBe('\x1b[7mtall.txt\x1b[0m');
    expect(r.status).toBe(0);
  });

  it.each<[string[], string, string]>([
    [[' '], 'line 10', ':'],
    [[' ', ' ', ' ', ' '], 'line 22', '(END)'],
    [[' ', 'b'], 'line 1', 'tall.txt'],
    [['j', 'j'], 'line 3', ':'],
    [['\x1b[B', '\x1b[A', '\x1b[B'], 'line 2', ':'],
    [['G'], 'line 22', '(END)'],
    [['G', 'g'], 'line 1', 'tall.txt'],
    [['d'], 'line 6', ':'],
    [['d', 'u'], 'line 1', 'tall.txt'],
    [['k'], 'line 1', 'tall.txt'],
    [['?', 'x'], 'line 1', 'tall.txt'],
  ])('keys %j: top line %s, status %s', async (keys, topLine, status) => {
    const r = await run('less tall.txt', {
      vfs: setup(),
      tty: { cols: 40, rows: 10 },
      keys: [...keys, 'q'],
    });
    const screen = lastScreen(r.out);
    expect(screen[0]).toBe(topLine);
    expect(screen[9]).toBe(`\x1b[7m${status}\x1b[0m`);
  });

  it('Ctrl+C also quits', async () => {
    const r = await run('less tall.txt', {
      vfs: setup(),
      tty: { cols: 40, rows: 10 },
      keys: ['\x03'],
    });
    expect(r.status).toBe(0);
  });

  it('pads short files with ~ and pages stdin', async () => {
    const r = await run('echo short | less', { tty: { cols: 40, rows: 5 }, keys: ['q'] });
    expect(lastScreen(r.out)).toEqual(['short', '~', '~', '~', '\x1b[7m(END)\x1b[0m']);
  });

  it('-N numbers lines', async () => {
    const r = await run('less -N letter.txt | cat');
    expect(r.out).toBe('      1 Dear apprentice,\n      2 the stacks are failing.\n');
  });

  it('needs a file when stdin is the terminal', async () => {
    const r = await run('less', { tty: { cols: 40, rows: 5 } });
    expect(r.err).toBe('Missing filename ("less --help" for help)\n');
    expect(r.status).toBe(1);
  });

  it('man shows a Grimoire page with header and footer', async () => {
    const r = await run('man ls | cat');
    const lines = r.out.split('\n');
    expect(lines[0]).toMatch(/^LS\(1\) +Grimoire of the Archive +LS\(1\)$/);
    expect(lines[0].length).toBe(80);
    expect(lines[2]).toBe('NAME');
    expect(lines[lines.length - 2]).toMatch(/^Archive of Echoes +LS\(1\)$/);
  });

  it('man pages interactively on a terminal', async () => {
    const r = await run('man cd', { tty: { cols: 60, rows: 8 }, keys: ['q'] });
    const screen = lastScreen(r.out);
    expect(screen[0]).toMatch(/^CD\(1\) +Grimoire of the Archive +CD\(1\)$/);
    expect(screen[7]).toBe('\x1b[7mManual page cd(1)\x1b[0m');
  });

  it('man with several pages reports missing ones but shows the rest', async () => {
    const r = await run('man nope pwd | head -n 3');
    expect(r.err).toBe('No manual entry for nope\n');
    expect(r.out).toContain('NAME');
  });

  it('wrapForScreen wraps and expands tabs', () => {
    expect(wrapForScreen('abcdef\n\na\tb\n', 4)).toEqual(['abcd', 'ef', '', 'a   ', '    ', 'b']);
  });
});

describe('--help and man pages', () => {
  const names = createRegistry().names();

  it.each(names.filter((n) => n !== 'echo'))('%s --help prints usage and exits 0', async (name) => {
    const r = await run(`${name} --help`);
    expect(r.status).toBe(0);
    expect(r.out.length).toBeGreaterThan(20);
    expect(r.err).toBe('');
  });

  it('echo --help just echoes, like the Bash builtin', async () => {
    expect((await run('echo --help')).out).toBe('--help\n');
  });

  it.each(names)('%s has a Grimoire page with NAME, SYNOPSIS, DESCRIPTION', (name) => {
    const page = createRegistry().get(name)!.manPage;
    for (const section of ['NAME', 'SYNOPSIS', 'DESCRIPTION']) expect(page).toContain(section);
    expect(page).not.toMatch(/—/); // no em dashes in player-facing text
  });

  it('builtins report bad options Bash-style', async () => {
    const r = await run('cd -z');
    expect(r.err).toBe('bash: cd: -z: invalid option\ncd: usage: cd [-L|[-P [-e]] [-@]] [dir]\n');
    expect(r.status).toBe(2);
  });
});

describe('locked spells', () => {
  it('answer in-world until learned', async () => {
    const vfs = testWorld();
    const shell = new Shell({
      vfs,
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      isUnlocked: (c) => c.unlockedInAct <= 1,
    });
    const locked = await run('cat letter.txt', { shell });
    expect(locked.err).toBe(`cat: ${LOCKED_MESSAGE}\n`);
    expect(locked.status).toBe(127);
    expect((await run('ls notes', { shell })).out).toBe('page1\npage2\n');
  });
});

describe('parseOptions', () => {
  const spec = {
    flags: 'abc',
    withValue: 'n',
    long: {
      all: { key: 'a' },
      almost: { key: 'b' },
      lines: { key: 'n', takesValue: true },
      color: { key: 'color', optionalValue: true },
    },
  };
  it('bundles, values, permutation, and --', () => {
    const p = parseOptions(['x', '-ab', '-n5', 'y', '-n', '7', '--', '-c'], spec);
    expect(p.flags).toEqual(['a', 'b']);
    expect(p.values.get('n')).toBe('7');
    expect(p.operands).toEqual(['x', 'y', '-c']);
  });
  it('long options: exact, prefix, =value, optional value', () => {
    const p = parseOptions(['--all', '--lin=3', '--color', '--color=auto', '-'], spec);
    expect(p.flags).toEqual(['a', 'color']);
    expect(p.values.get('n')).toBe('3');
    expect(p.values.get('color')).toBe('auto');
    expect(p.operands).toEqual(['-']);
  });
  it('stopAtOperand leaves later dashes as operands', () => {
    const p = parseOptions(['-a', 'dir', '-b'], { ...spec, stopAtOperand: true });
    expect(p.operands).toEqual(['dir', '-b']);
  });
  it.each<[string[], string]>([
    [['-z'], "invalid option -- 'z'"],
    [['-n'], "option requires an argument -- 'n'"],
    [['--nope'], "unrecognized option '--nope'"],
    [['--al'], "option '--al' is ambiguous; possibilities: '--all' '--almost'"],
    [['--lines'], "option '--lines' requires an argument"],
    [['--all=1'], "option '--all' doesn't allow an argument"],
  ])('%j -> %s', (args, msg) => {
    expect(() => parseOptions(args, spec)).toThrow(new OptionError(msg));
  });
});

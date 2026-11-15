import { makeShell } from './test-helpers';

interface Case {
  cmd: string;
  out?: string;
  err?: string;
  status?: number;
  /** Files expected afterward (path relative to home -> content). */
  files?: Record<string, string>;
}

/**
 * Each snippet's expected stdout, stderr, and status match what real Bash
 * 5.x prints with equivalent shell functions standing in for the stubs
 * (cross-checked when written). Game-only cases (permissions, background job
 * lines, the `boom` crash) are the exceptions.
 */
const cases: Case[] = [
  // Simple commands and quoting
  { cmd: 'echo hello', out: 'hello\n' },
  { cmd: 'echo   spaced    out  ', out: 'spaced out\n' },
  { cmd: 'echo "  kept  "', out: '  kept  \n' },
  { cmd: "args 'a b' c", out: '<a b><c>\n' },
  { cmd: 'args a\\ b', out: '<a b>\n' },
  { cmd: 'args "" x', out: '<><x>\n' },
  { cmd: 'args a"b"\'c\'', out: '<abc>\n' },
  { cmd: 'echo -n hi', out: 'hi' },
  { cmd: '', out: '', status: 0 },
  { cmd: '# just a comment', out: '' },

  // Variables
  { cmd: 'echo $SPELL', out: 'lumen\n' },
  { cmd: 'echo "$SPELL!"', out: 'lumen!\n' },
  { cmd: "echo '$SPELL'", out: '$SPELL\n' },
  { cmd: 'echo ${SPELL}s', out: 'lumens\n' },
  { cmd: 'echo $SPELLs', out: '\n' },
  { cmd: 'args $MANY', out: '<a><b><c>\n' },
  { cmd: 'args "$MANY"', out: '<a  b   c>\n' },
  { cmd: 'args $EMPTY x', out: '<x>\n' },
  { cmd: 'args "$EMPTY" x', out: '<><x>\n' },
  { cmd: 'args $UNSET', out: '\n' },
  { cmd: 'echo cost: \\$5', out: 'cost: $5\n' },
  { cmd: 'echo a$', out: 'a$\n' },
  { cmd: 'X=1; echo $X', out: '1\n' },
  { cmd: 'X=old; X=new echo $X', out: 'old\n' },
  { cmd: 'X=tmp printenv X; printenv X', out: 'tmp\n', status: 1 },
  { cmd: 'Y="a b"; args $Y', out: '<a><b>\n' },
  { cmd: 'Z=$SPELL$SPELL; echo $Z', out: 'lumenlumen\n' },

  // Tilde
  { cmd: 'echo ~', out: '/home/apprentice\n' },
  { cmd: 'echo ~/notes', out: '/home/apprentice/notes\n' },
  { cmd: 'echo "~" a~', out: '~ a~\n' },
  { cmd: 'D=~/x; echo $D', out: '/home/apprentice/x\n' },

  // Globs
  { cmd: 'echo *.txt', out: 'a.txt b.txt\n' },
  { cmd: 'echo *', out: 'a.txt b.txt c.md notes two words\n' },
  { cmd: 'args *', out: '<a.txt><b.txt><c.md><notes><two words>\n' },
  { cmd: 'echo .*', out: '.hidden\n' },
  { cmd: 'echo notes/*', out: 'notes/page1 notes/page2\n' },
  { cmd: 'echo ?.md', out: 'c.md\n' },
  { cmd: 'echo [ab].txt', out: 'a.txt b.txt\n' },
  { cmd: 'echo *.zip', out: '*.zip\n' },
  { cmd: 'echo "*.txt"', out: '*.txt\n' },
  { cmd: 'echo \\*.txt', out: '*.txt\n' },
  { cmd: 'echo $STAR', out: 'a.txt b.txt\n' },
  { cmd: 'echo "$STAR"', out: '*.txt\n' },
  { cmd: 'echo ~/*.md', out: '/home/apprentice/c.md\n' },
  { cmd: 'cat *.txt', out: 'alpha\nbeta\n' },

  // Exit status and chaining
  { cmd: 'true', status: 0 },
  { cmd: 'false', status: 1 },
  { cmd: 'false; echo $?', out: '1\n' },
  { cmd: 'status 7; echo $?; echo $?', out: '7\n0\n' },
  { cmd: 'true && echo yes', out: 'yes\n' },
  { cmd: 'false && echo yes', out: '', status: 1 },
  { cmd: 'false || echo rescued', out: 'rescued\n' },
  { cmd: 'true || echo no', out: '', status: 0 },
  { cmd: 'false && echo a || echo b', out: 'b\n' },
  { cmd: 'true && false || echo c', out: 'c\n' },
  { cmd: 'false || false && echo d', out: '', status: 1 },
  { cmd: 'echo a; echo b; echo c', out: 'a\nb\nc\n' },
  { cmd: 'false; true', status: 0 },

  // Pipes
  { cmd: 'echo spell | upper', out: 'SPELL\n' },
  { cmd: 'cat a.txt b.txt | upper | countlines', out: '2\n' },
  { cmd: 'false | true', status: 0 },
  { cmd: 'true | false', status: 1 },
  { cmd: 'err oops | upper', out: '', err: 'oops\n' },
  { cmd: 'err oops 2>&1 | upper', out: 'OOPS\n' },
  { cmd: 'echo x | tty', out: 'not a tty\n' },
  { cmd: 'tty', out: 'terminal\n' },
  { cmd: 'echo x | echo y', out: 'y\n' },

  // Redirection
  { cmd: 'echo saved > out.txt', out: '', files: { 'out.txt': 'saved\n' } },
  { cmd: 'echo a > f; echo b > f', files: { f: 'b\n' } },
  { cmd: 'echo a > f; echo b >> f', files: { f: 'a\nb\n' } },
  { cmd: '>empty', files: { empty: '' } },
  { cmd: 'upper < a.txt', out: 'ALPHA\n' },
  { cmd: 'upper < a.txt > up.txt', files: { 'up.txt': 'ALPHA\n' } },
  { cmd: 'err bad 2> e.log', err: '', status: 1, files: { 'e.log': 'bad\n' } },
  { cmd: 'err a 2> e; err b 2>> e', files: { e: 'a\nb\n' }, status: 1 },
  { cmd: 'both > o 2>&1', out: '', files: { o: 'out\nerr\n' } },
  { cmd: 'both 2>&1 > o', out: 'err\n', err: '', files: { o: 'out\n' } },
  { cmd: 'both &> o', files: { o: 'out\nerr\n' } },
  { cmd: 'both >&2', out: '', err: 'out\nerr\n' },
  { cmd: 'both 2>/dev/null', out: 'out\n', err: '' },
  { cmd: 'both > /dev/null', out: '', err: 'err\n' },
  { cmd: 'cat < /dev/null', out: '' },
  { cmd: 'echo x | upper > o; cat o', out: 'X\n' },
  { cmd: 'echo "$SPELL" > "two words"', files: { 'two words': 'lumen\n' } },
  { cmd: 'N=log.txt; echo hi > $N', files: { 'log.txt': 'hi\n' } },
  { cmd: 'echo hi > $MANY', err: 'bash: $MANY: ambiguous redirect\n', status: 1 },
  { cmd: 'echo hi > *.txt', err: 'bash: *.txt: ambiguous redirect\n', status: 1 },
  { cmd: 'echo x > c*', files: { 'c.md': 'x\n' } },
  { cmd: 'echo hi > notes', err: 'bash: notes: Is a directory\n', status: 1 },
  { cmd: 'echo hi > nope/x', err: 'bash: nope/x: No such file or directory\n', status: 1 },
  { cmd: 'echo hi > /vault/x', err: 'bash: /vault/x: Permission denied\n', status: 1 },
  { cmd: 'cat < missing', err: 'bash: missing: No such file or directory\n', status: 1 },
  {
    cmd: 'cat < missing && echo no || echo handled',
    out: 'handled\n',
    err: 'bash: missing: No such file or directory\n',
  },
  { cmd: 'echo x 3> f', err: 'bash: 3: Bad file descriptor\n', status: 1 },
  { cmd: 'echo x >&3', err: 'bash: 3: ambiguous redirect\n', status: 1 },
  { cmd: 'both 2>&-', out: 'out\n', err: '' },
  { cmd: 'echo a 1>f', files: { f: 'a\n' } },

  // Errors
  { cmd: 'lionX', err: 'bash: lionX: command not found\n', status: 127 },
  { cmd: 'lionX; echo $?', out: '127\n', err: 'bash: lionX: command not found\n' },
  { cmd: 'echo a |', err: "bash: syntax error near unexpected token `newline'\n", status: 2 },
  { cmd: '| echo a', err: "bash: syntax error near unexpected token `|'\n", status: 2 },
  {
    cmd: "echo 'unclosed",
    err: "bash: unexpected EOF while looking for matching `''\n",
    status: 2,
  },
  { cmd: 'boom', err: 'bash: boom: Error: kaboom\n', status: 1 },
  {
    cmd: 'cat missing a.txt',
    out: 'alpha\n',
    err: 'cat: missing: No such file or directory\n',
    status: 1,
  },

  // Background
  { cmd: 'echo bg &', out: 'bg\n', err: '[1] 1000\n', status: 0 },
  { cmd: 'false & echo $?', out: '0\n', err: '[1] 1000\n' },
  { cmd: 'echo a & echo b &', out: 'a\nb\n', err: '[1] 1000\n[2] 1001\n' },
];

describe('shell executor: bash snippets', () => {
  it('has at least 50 snippets', () => expect(cases.length).toBeGreaterThanOrEqual(50));

  it.each(cases)('$cmd', async ({ cmd, out, err, status, files }) => {
    const { shell, vfs, output } = makeShell();
    const code = await shell.run(cmd);
    const o = output();
    if (out !== undefined) expect(o.out).toBe(out);
    expect(o.err).toBe(err ?? '');
    if (status !== undefined) expect(code).toBe(status);
    expect(shell.lastStatus).toBe(code);
    for (const [path, content] of Object.entries(files ?? {})) {
      expect(vfs.readFile(path)).toBe(content);
    }
  });
});

describe('shell executor: state across lines', () => {
  it('keeps variables and $? between runs', async () => {
    const { shell, output } = makeShell();
    await shell.run('GREETING=hail');
    await shell.run('false');
    await shell.run('echo $GREETING $?');
    expect(output().out).toBe('hail 1\n');
  });

  it('cd changes where later commands and globs resolve', async () => {
    const { shell, vfs, output } = makeShell();
    await shell.run('cd notes && echo *');
    expect(vfs.cwd).toBe('/home/apprentice/notes');
    await shell.run('cd /vault');
    expect(output()).toEqual({
      out: 'page1 page2\n',
      err: 'bash: cd: /vault: Permission denied\n',
    });
  });

  it('a redirect truncates even if the command then fails', async () => {
    const { shell, vfs } = makeShell();
    await shell.run('echo keep > f');
    await shell.run('lionX > f');
    expect(vfs.readFile('f')).toBe('');
  });

  it('job numbers keep counting', async () => {
    const { shell, output } = makeShell();
    await shell.run('true &');
    await shell.run('true &');
    expect(output().err).toBe('[1] 1000\n[2] 1001\n');
  });

  it('HOME comes from the vfs unless given', () => {
    const { shell } = makeShell();
    expect(shell.env.get('HOME')).toBe('/home/apprentice');
  });

  it('uses the configured shell name in errors', async () => {
    const { vfs } = makeShell();
    const { Shell } = await import('./executor');
    const { CommandRegistry } = await import('../commands/types');
    let err = '';
    const sh = new Shell({
      vfs,
      registry: new CommandRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write: (s) => (err += s) } },
      shellName: 'lexicon',
    });
    await sh.run('nope');
    expect(err).toBe('lexicon: nope: command not found\n');
  });
});

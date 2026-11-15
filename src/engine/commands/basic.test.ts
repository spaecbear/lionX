import { CommandRegistry, createRegistry, type IO } from '.';
import { Vfs } from '../vfs';
import { CLEAR_SEQUENCE } from './clear';

async function run(name: string, args: string[]) {
  let stdout = '';
  let stderr = '';
  const io: IO = {
    stdin: '',
    stdinIsTerminal: true,
    stdoutIsTerminal: false,
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
  };
  const registry = createRegistry();
  const status = await registry
    .get(name)!
    .run(args, io, { vfs: new Vfs(), env: new Map(), registry, shellName: 'bash' });
  return { stdout, stderr, status };
}

describe('echo', () => {
  it.each<[string[], string]>([
    [[], '\n'],
    [['hello', 'world'], 'hello world\n'],
    [['-n', 'x'], 'x'],
    [['-e', 'a\\tb\\nc'], 'a\tb\nc\n'],
    [['a\\tb'], 'a\\tb\n'],
    [['-ne', 'x\\n'], 'x\n'],
    [['-eE', 'a\\tb'], 'a\\tb\n'],
    [['-e', 'stop\\chere'], 'stop'],
    [['-e', '\\0101\\x'], 'A\\x\n'],
    [['-e', 'back\\\\slash'], 'back\\slash\n'],
    [['-e', 'trailing\\'], 'trailing\\\n'],
    [['-x', 'y'], '-x y\n'],
    [['--', 'y'], '-- y\n'],
    [['x', '-n'], 'x -n\n'],
  ])('echo %j', async (args, out) => {
    expect((await run('echo', args)).stdout).toBe(out);
  });
});

describe('clear', () => {
  it('prints the clear sequence', async () => {
    expect(await run('clear', [])).toEqual({ stdout: CLEAR_SEQUENCE, stderr: '', status: 0 });
  });
  it('-x keeps scrollback', async () => {
    expect((await run('clear', ['-x'])).stdout).toBe('\x1b[H\x1b[2J');
  });
  it('rejects unknown options', async () => {
    const r = await run('clear', ['-q']);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("clear: invalid option -- 'q'\nUsage: clear [options]\n");
  });
});

describe('registry', () => {
  it('lists, finds, and ships man pages for every command', () => {
    const r = createRegistry();
    expect(r.names()).toEqual([
      'cat',
      'cd',
      'clear',
      'echo',
      'head',
      'less',
      'ls',
      'man',
      'pwd',
      'tail',
    ]);
    expect(r.has('echo')).toBe(true);
    expect(r.has('lionX')).toBe(false);
    for (const n of r.names()) expect(r.get(n)!.manPage).toMatch(/^NAME/);
    expect(new CommandRegistry().names()).toEqual([]);
  });

  it('every command declares the wing that teaches it', () => {
    const wings = Object.fromEntries(
      createRegistry()
        .names()
        .map((n) => [n, createRegistry().get(n)!.unlockedInAct]),
    );
    expect(wings).toEqual({
      cat: 2,
      cd: 1,
      clear: 1,
      echo: 8,
      head: 2,
      less: 2,
      ls: 1,
      man: 2,
      pwd: 1,
      tail: 2,
    });
  });
});

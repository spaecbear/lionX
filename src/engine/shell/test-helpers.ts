import { CommandRegistry, type Command } from '../commands/types';
import { Vfs } from '../vfs';
import { Shell } from './executor';

/** Minimal stand-ins for real commands, enough to observe the shell's behavior. */
function stub(name: string, run: Command['run']): Command {
  return { name, unlockedInAct: 0, manPage: '', run };
}

export const stubCommands: Command[] = [
  stub('echo', async (args, io) => {
    const n = args[0] === '-n';
    io.stdout.write(args.slice(n ? 1 : 0).join(' ') + (n ? '' : '\n'));
    return 0;
  }),
  /** Prints each argument in angle brackets, to make word splitting visible. */
  stub('args', async (args, io) => {
    io.stdout.write(args.map((a) => `<${a}>`).join('') + '\n');
    return 0;
  }),
  stub('cat', async (args, io, ctx) => {
    if (args.length === 0) {
      io.stdout.write(io.stdin);
      return 0;
    }
    let status = 0;
    for (const a of args) {
      try {
        io.stdout.write(ctx.vfs.readFile(a));
      } catch (e) {
        io.stderr.write(`cat: ${(e as Error).message}\n`);
        status = 1;
      }
    }
    return status;
  }),
  stub('true', async () => 0),
  stub('false', async () => 1),
  stub('status', async (args) => Number(args[0])),
  stub('err', async (args, io) => {
    io.stderr.write(args.join(' ') + '\n');
    return 1;
  }),
  stub('both', async (_args, io) => {
    io.stdout.write('out\n');
    io.stderr.write('err\n');
    return 0;
  }),
  stub('upper', async (_args, io) => {
    io.stdout.write(io.stdin.toUpperCase());
    return 0;
  }),
  stub('countlines', async (_args, io) => {
    io.stdout.write(`${io.stdin.split('\n').filter(Boolean).length}\n`);
    return 0;
  }),
  stub('printenv', async (args, io, ctx) => {
    const v = ctx.env.get(args[0]);
    if (v === undefined) return 1;
    io.stdout.write(v + '\n');
    return 0;
  }),
  stub('tty', async (_args, io) => {
    io.stdout.write(io.stdinIsTerminal ? 'terminal\n' : 'not a tty\n');
    return 0;
  }),
  stub('cd', async (args, io, ctx) => {
    try {
      ctx.vfs.chdir(args[0] ?? ctx.env.get('HOME') ?? '/');
      return 0;
    } catch (e) {
      io.stderr.write(`${ctx.shellName}: cd: ${(e as Error).message}\n`);
      return 1;
    }
  }),
  stub('boom', async () => {
    throw new Error('kaboom');
  }),
];

/** A small apprentice cell to run snippets in. */
export function makeShell() {
  const vfs = new Vfs({ home: '/home/apprentice', now: () => 0 });
  vfs.mkdir('/home/apprentice/notes', { parents: true });
  vfs.mkdir('/dev');
  vfs.mkdir('/vault');
  vfs.writeFile('/vault/seal', 'sealed\n');
  vfs.chmod('/vault', 0o700);
  vfs.chown('/home/apprentice', 'apprentice', 'apprentice');
  vfs.chown('/home/apprentice/notes', 'apprentice', 'apprentice');
  vfs.credentials = { user: 'apprentice', groups: ['apprentice'] };
  vfs.chdir('~');
  vfs.writeFile('a.txt', 'alpha\n');
  vfs.writeFile('b.txt', 'beta\n');
  vfs.writeFile('c.md', 'gamma\n');
  vfs.writeFile('.hidden', 'secret\n');
  vfs.writeFile('two words', 'spaced\n');
  vfs.writeFile('notes/page1', 'one\n');
  vfs.writeFile('notes/page2', 'two\n');

  let out = '';
  let err = '';
  const shell = new Shell({
    vfs,
    registry: new CommandRegistry().register(...stubCommands),
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    env: { USER: 'apprentice', SPELL: 'lumen', EMPTY: '', MANY: 'a  b   c', STAR: '*.txt' },
  });
  return {
    shell,
    vfs,
    output: () => ({ out, err }),
    reset: () => {
      out = '';
      err = '';
    },
  };
}

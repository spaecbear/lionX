import { Shell } from '../shell';
import { buildWorld, type Vfs, type WorldSpec } from '../vfs';
import { createRegistry } from '.';
import type { Tty } from './types';

export const T_NOW = Date.UTC(2026, 10, 15, 0, 31); // Nov 15 2026 00:31 UTC
export const T_FILE = Date.UTC(2026, 10, 14, 20, 15); // Nov 14 20:15
export const T_OLD = Date.UTC(2025, 0, 2, 9, 0); // Jan  2  2025

const journal = Array.from({ length: 15 }, (_, i) => `entry ${i + 1}`).join('\n') + '\n';
const manyNames = [
  'a',
  'bb',
  'ccc',
  'dddd',
  'eeeee',
  'ffffff',
  'ggggggg',
  'hhhhhhhh',
  'iiiiiiiii',
  'jjjjjjjjjj',
  'k1',
  'l22',
  'm333',
  'n4444',
  'o55555',
  'p666666',
  'q7777777',
  'r88888888',
  's999999999',
  't',
];

/** The test world: an apprentice's cell, a sealed vault, and some books. */
export function worldSpec(): WorldSpec {
  return {
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    dirs: [
      '/home/apprentice/notes',
      '/home/apprentice/many',
      '/atrium',
      { path: '/vault', mode: '700', owner: 'lionx', group: 'lionx' },
    ],
    files: {
      '/home/apprentice/journal.txt': journal,
      '/home/apprentice/letter.txt': 'Dear apprentice,\nthe stacks are failing.\n',
      '/home/apprentice/empty.txt': '',
      '/home/apprentice/no-newline.txt': 'first\nlast line',
      '/home/apprentice/blanks.txt': 'a\n\n\n\nb\n',
      '/home/apprentice/.sealed-tome': 'hidden\n',
      '/home/apprentice/two words.txt': 'spaced\n',
      '/home/apprentice/run.sh': { content: 'echo ritual\n', mode: '755' },
      '/home/apprentice/big.txt': 'x'.repeat(4999) + '\n',
      '/home/apprentice/notes/page1': 'one\n',
      '/home/apprentice/notes/page2': 'two\n',
      ...Object.fromEntries(manyNames.map((n) => [`/home/apprentice/many/${n}`, ''])),
      '/vault/seal': { content: 'lionX was here\n', owner: 'lionx', group: 'lionx' },
    },
  };
}

/** Build the world with every node stamped at T_FILE (old.txt at T_OLD) and the clock at T_NOW. */
export function testWorld(now = T_NOW, fileTime = T_FILE, oldTime = T_OLD): Vfs {
  let t = fileTime;
  const vfs = buildWorld(worldSpec(), { now: () => t });
  t = oldTime;
  vfs.writeFile('/home/apprentice/old.txt', 'ancient\n');
  t = fileTime;
  vfs.touch('/home/apprentice'); // home's mtime back to T_FILE after adding old.txt
  t = now;
  return vfs;
}

export interface RunResult {
  out: string;
  err: string;
  status: number;
}

/**
 * Run a command line. With `tty`, stdout is a terminal of that size and
 * `keys` are fed to interactive programs.
 */
export async function run(
  line: string,
  opts: { vfs?: Vfs; tty?: { cols: number; rows: number }; keys?: string[]; shell?: Shell } = {},
): Promise<RunResult & { shell: Shell; vfs: Vfs }> {
  const vfs = opts.vfs ?? opts.shell?.vfs ?? testWorld();
  let out = '';
  let err = '';
  const keys = [...(opts.keys ?? [])];
  const tty: Tty | undefined = opts.tty && {
    ...opts.tty,
    readKey: async () => {
      const k = keys.shift();
      if (k === undefined) throw new Error('pager waited for a key, but none were left');
      return k;
    },
  };
  const shell =
    opts.shell ??
    new Shell({
      vfs,
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      env: { USER: 'apprentice' },
    });
  shell.terminal = { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } };
  shell.tty = tty;
  const status = await shell.run(line);
  return { out, err, status, shell, vfs };
}

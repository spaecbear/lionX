import type { Vfs } from '../vfs';

/**
 * Goal predicates. Puzzles check the state of the world, never the exact
 * command typed. `ran` and `read` look at what happened during the current
 * step, for lessons whose spell changes nothing (like `ls` or `cat`).
 */
export type Predicate =
  | { exists: string }
  | { missing: string }
  | { isDir: string }
  | { isFile: string }
  | { contains: { path: string; text?: string; pattern?: string } }
  | { mode: { path: string; mode: string } }
  | { owner: { path: string; owner?: string; group?: string } }
  | { cwdIs: string }
  | { processRunning: string }
  | { ran: string | { command: string; status?: number | 'any'; args?: string[] } }
  | { read: string }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export interface CommandEvent {
  /** The command name as typed (first word), e.g. "ls". */
  command: string;
  args: string[];
  status: number;
}

export interface WorldView {
  /** Inspected with full (root) access, so wards never hide the answer from the checker. */
  vfs: Vfs;
  /** Commands run since the step began. */
  commands: CommandEvent[];
  /** Absolute paths of files read since the step began. */
  reads: Set<string>;
  /** Names of running processes (empty until the process table exists). */
  processes: string[];
}

export const PREDICATE_KEYS = [
  'exists',
  'missing',
  'isDir',
  'isFile',
  'contains',
  'mode',
  'owner',
  'cwdIs',
  'processRunning',
  'ran',
  'read',
  'all',
  'any',
  'not',
] as const;

/** Run `fn` with root credentials, restoring the player's afterwards. */
function asRoot<T>(vfs: Vfs, fn: () => T): T {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    return fn();
  } finally {
    vfs.credentials = saved;
  }
}

export function evaluate(p: Predicate, w: WorldView): boolean {
  const vfs = w.vfs;
  if ('all' in p) return p.all.every((q) => evaluate(q, w));
  if ('any' in p) return p.any.some((q) => evaluate(q, w));
  if ('not' in p) return !evaluate(p.not, w);
  if ('cwdIs' in p) return vfs.cwd === vfs.resolve(p.cwdIs);
  if ('processRunning' in p) return w.processes.includes(p.processRunning);
  if ('read' in p) return w.reads.has(vfs.resolve(p.read));
  if ('ran' in p) {
    const want = typeof p.ran === 'string' ? { command: p.ran } : p.ran;
    return w.commands.some(
      (c) =>
        c.command === want.command &&
        (want.status === 'any' || c.status === (want.status ?? 0)) &&
        (want.args ?? []).every((a) => c.args.includes(a)),
    );
  }
  return asRoot(vfs, () => {
    if ('exists' in p) return vfs.exists(p.exists);
    if ('missing' in p) return !vfs.exists(p.missing);
    if ('isDir' in p) return vfs.isDir(p.isDir);
    if ('isFile' in p) return vfs.isFile(p.isFile);
    if ('contains' in p) {
      const { path, text, pattern } = p.contains;
      if (!vfs.isFile(path)) return false;
      const body = vfs.readFileQuietly(path);
      if (text !== undefined && !body.includes(text)) return false;
      if (pattern !== undefined && !new RegExp(pattern, 'm').test(body)) return false;
      return true;
    }
    if ('mode' in p) {
      if (!vfs.exists(p.mode.path)) return false;
      return vfs.stat(p.mode.path).mode === parseInt(p.mode.mode, 8);
    }
    if ('owner' in p) {
      if (!vfs.exists(p.owner.path)) return false;
      const s = vfs.stat(p.owner.path);
      return (
        (p.owner.owner === undefined || s.owner === p.owner.owner) &&
        (p.owner.group === undefined || s.group === p.owner.group)
      );
    }
    throw new Error(`Unknown predicate: ${JSON.stringify(p)}`);
  });
}

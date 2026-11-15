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
  /** Some permission bits for owner (u), group (g), or others (o): has all of `has`, none of `lacks`. */
  | { perm: { path: string; who: 'u' | 'g' | 'o'; has?: string; lacks?: string } }
  | { owner: { path: string; owner?: string; group?: string } }
  | { cwdIs: string }
  /** A shell variable: set, equal to `value` or matching `pattern`, and (optionally) exported. */
  | { variable: { name: string; value?: string; pattern?: string; exported?: boolean } }
  /** An alias exists (with `value`, if given). */
  | { alias: { name: string; value?: string } }
  | { processRunning: string }
  /** Every running process with this name is at least this nice. */
  | { niceAtLeast: { name: string; nice: number } }
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
  /** Niceness of each running process with a name. */
  niceness?: (name: string) => number[];
  /** The shell's variables, exports, and aliases, when goals need them. */
  shell?: { env: Map<string, string>; exported: Set<string>; aliases: Map<string, string> };
}

export const PREDICATE_KEYS = [
  'exists',
  'missing',
  'isDir',
  'isFile',
  'contains',
  'mode',
  'perm',
  'owner',
  'cwdIs',
  'variable',
  'alias',
  'processRunning',
  'niceAtLeast',
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
  if ('variable' in p) {
    const v = w.shell?.env.get(p.variable.name);
    if (v === undefined) return false;
    if (p.variable.value !== undefined && v !== p.variable.value) return false;
    if (p.variable.pattern !== undefined && !new RegExp(p.variable.pattern).test(v)) return false;
    if (p.variable.exported && !w.shell?.exported.has(p.variable.name)) return false;
    return true;
  }
  if ('alias' in p) {
    const a = w.shell?.aliases.get(p.alias.name);
    return a !== undefined && (p.alias.value === undefined || a === p.alias.value);
  }
  if ('processRunning' in p) return w.processes.includes(p.processRunning);
  if ('niceAtLeast' in p) {
    const ns = w.niceness?.(p.niceAtLeast.name) ?? [];
    return ns.length > 0 && ns.every((n) => n >= p.niceAtLeast.nice);
  }
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
    if ('perm' in p) {
      if (!vfs.exists(p.perm.path)) return false;
      const shift = { u: 6, g: 3, o: 0 }[p.perm.who];
      const bits = (vfs.stat(p.perm.path).mode >> shift) & 7;
      const bit = (c: string) => ({ r: 4, w: 2, x: 1 })[c as 'r' | 'w' | 'x'] ?? 0;
      return (
        [...(p.perm.has ?? '')].every((c) => bits & bit(c)) &&
        [...(p.perm.lacks ?? '')].every((c) => !(bits & bit(c)))
      );
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

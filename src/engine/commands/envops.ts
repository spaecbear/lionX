import { isVfsError } from '../vfs';
import type { IO, ShellContext } from './types';
import { defineCommand, helpText, manPageFor } from './util';

/** Bash's single-quote quoting for printing values back. */
const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const exportCmd = defineCommand({
  name: 'export',
  unlockedInAct: 8,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'np' },
  run(o, io, ctx) {
    const exec = ctx.exec;
    if (!exec) return 0;
    if (o.operands.length === 0 || o.has('p')) {
      for (const k of [...exec.exported].sort()) {
        const v = ctx.env.get(k);
        io.stdout.write(
          v === undefined
            ? `declare -x ${k}\n`
            : `declare -x ${k}="${v.replace(/(["\\$`])/g, '\\$1')}"\n`,
        );
      }
      return 0;
    }
    let status = 0;
    for (const arg of o.operands) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      if (!NAME.test(name)) {
        io.stderr.write(`${ctx.shellName}: export: \`${arg}': not a valid identifier\n`);
        status = 1;
        continue;
      }
      if (eq !== -1) ctx.env.set(name, arg.slice(eq + 1));
      if (o.has('n')) exec.exported.delete(name);
      else exec.exported.add(name);
    }
    return status;
  },
});

export const alias = defineCommand({
  name: 'alias',
  unlockedInAct: 8,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'p' },
  run(o, io, ctx) {
    const a = ctx.exec?.aliases;
    if (!a) return 0;
    if (o.operands.length === 0) {
      for (const [k, v] of [...a].sort(([x], [y]) => (x < y ? -1 : 1)))
        io.stdout.write(`alias ${k}=${sq(v)}\n`);
      return 0;
    }
    let status = 0;
    for (const arg of o.operands) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        if (a.has(arg)) io.stdout.write(`alias ${arg}=${sq(a.get(arg)!)}\n`);
        else {
          io.stderr.write(`${ctx.shellName}: alias: ${arg}: not found\n`);
          status = 1;
        }
        continue;
      }
      a.set(arg.slice(0, eq), arg.slice(eq + 1));
    }
    return status;
  },
});

export const unalias = defineCommand({
  name: 'unalias',
  unlockedInAct: 8,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'a' },
  run(o, io, ctx) {
    const a = ctx.exec?.aliases;
    if (!a) return 0;
    if (o.has('a')) {
      a.clear();
      return 0;
    }
    if (o.operands.length === 0) {
      io.stderr.write('unalias: usage: unalias [-a] name [name ...]\n');
      return 2;
    }
    let status = 0;
    for (const n of o.operands) {
      if (!a.delete(n)) {
        io.stderr.write(`${ctx.shellName}: unalias: ${n}: not found\n`);
        status = 1;
      }
    }
    return status;
  },
});

/** Debian's which: prints the first match on PATH for each name, silently fails otherwise. */
export const which = defineCommand({
  name: 'which',
  unlockedInAct: 8,
  options: { flags: 'a' },
  run(o, io, ctx) {
    let status = 0;
    for (const n of o.operands) {
      const PATH = ctx.env.get('PATH') ?? '';
      const found: string[] = [];
      for (const dir of PATH.split(':')) {
        const c = `${dir || '.'}/${n}`;
        if (ctx.vfs.isFile(c) && ctx.vfs.access(c, 'x')) found.push(c);
      }
      if (found.length === 0) status = 1;
      for (const f of o.has('a') ? found : found.slice(0, 1)) io.stdout.write(f + '\n');
    }
    return status;
  },
});

export const type = defineCommand({
  name: 'type',
  unlockedInAct: 8,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'tp' },
  run(o, io, ctx) {
    let status = 0;
    for (const n of o.operands) {
      const r = ctx.exec?.lookup(n) ?? { kind: 'none' as const };
      if (o.has('t')) {
        if (r.kind === 'none') status = 1;
        else io.stdout.write({ alias: 'alias', builtin: 'builtin', file: 'file' }[r.kind] + '\n');
        continue;
      }
      if (r.kind === 'alias') io.stdout.write(`${n} is aliased to \`${r.value}'\n`);
      else if (r.kind === 'builtin') io.stdout.write(`${n} is a shell builtin\n`);
      else if (r.kind === 'file') io.stdout.write(`${n} is ${r.path}\n`);
      else {
        io.stderr.write(`${ctx.shellName}: type: ${n}: not found\n`);
        status = 1;
      }
    }
    return status;
  },
});

function exportedLines(ctx: ShellContext): string[] {
  const names = ctx.exec ? [...ctx.exec.exported] : [...ctx.env.keys()];
  return names
    .filter((k) => ctx.env.has(k))
    .sort()
    .map((k) => `${k}=${ctx.env.get(k)}`);
}

export const env = defineCommand({
  name: 'env',
  unlockedInAct: 8,
  options: {},
  run(_o, io, ctx) {
    io.stdout.write(
      exportedLines(ctx)
        .map((l) => l + '\n')
        .join(''),
    );
    return 0;
  },
});

export const printenv = defineCommand({
  name: 'printenv',
  unlockedInAct: 8,
  options: {},
  run(o, io, ctx) {
    if (o.operands.length === 0) {
      io.stdout.write(
        exportedLines(ctx)
          .map((l) => l + '\n')
          .join(''),
      );
      return 0;
    }
    let status = 0;
    for (const n of o.operands) {
      const exported = ctx.exec ? ctx.exec.exported.has(n) : true;
      if (exported && ctx.env.has(n)) io.stdout.write(ctx.env.get(n) + '\n');
      else status = 1;
    }
    return status;
  },
});

/** `source FILE` and `. FILE`: run a file's lines in the current shell. */
function makeSource(name: 'source' | '.') {
  return {
    name,
    unlockedInAct: 8,
    manPage: manPageFor('source'),
    help: helpText('source'),
    async run(args: string[], io: IO, ctx: ShellContext): Promise<number> {
      if (args[0] === '--help') {
        io.stdout.write(helpText('source'));
        return 0;
      }
      if (!args[0]) {
        io.stderr.write(
          `${ctx.shellName}: ${name}: filename argument required\n${name}: usage: ${name} filename [arguments]\n`,
        );
        return 2;
      }
      try {
        return await ctx.exec!.source(args[0], io);
      } catch (e) {
        if (isVfsError(e)) {
          io.stderr.write(`${ctx.shellName}: ${args[0]}: ${e.reason}\n`);
          return 1;
        }
        throw e;
      }
    },
  };
}

export const source = makeSource('source');
export const dot = makeSource('.');

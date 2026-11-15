import { VfsError } from '../vfs';
import { OptionError, parseOptions, type OptionSpec, type ParsedOptions } from './options';
import type { Command, IO, ShellContext } from './types';

const grimoire = import.meta.glob<string>('../../content/grimoire/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const helps = import.meta.glob<string>('../../content/help/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The Grimoire page for a command, from src/content/grimoire. */
export function manPageFor(name: string): string {
  return doc(grimoire, 'grimoire', name);
}

/** The `--help` text for a command, from src/content/help. */
export function helpText(name: string): string {
  return doc(helps, 'help', name);
}

function doc(table: Record<string, string>, dir: string, name: string): string {
  return table[`../../content/${dir}/${name}.txt`] ?? '';
}

export interface CommandDef {
  name: string;
  unlockedInAct: number;
  options: OptionSpec;
  /** Exit status for bad options. GNU ls uses 2; most tools use 1; builtins use 2. */
  usageStatus?: number;
  /** Builtins report errors as "bash: cd: ..." instead of "cd: ...". */
  builtin?: boolean;
  run(opts: ParsedOptions, io: IO, ctx: ShellContext): Promise<number> | number;
}

/**
 * Wrap a command with GNU-style option parsing, `--help`, and the standard
 * "Try 'x --help'" error. The man page and help text come from src/content.
 */
export function defineCommand(def: CommandDef): Command {
  const help = doc(helps, 'help', def.name);
  const spec: OptionSpec = {
    ...def.options,
    long: { ...def.options.long, help: { key: '--help' } },
  };
  return {
    name: def.name,
    unlockedInAct: def.unlockedInAct,
    manPage: doc(grimoire, 'grimoire', def.name),
    help,
    async run(args, io, ctx) {
      let opts: ParsedOptions;
      try {
        opts = parseOptions(args, spec);
      } catch (e) {
        if (!(e instanceof OptionError)) throw e;
        if (def.builtin) {
          const bad = /'(-.*)'|-- '(.)'/.exec(e.message);
          const shown = bad ? (bad[1] ?? `-${bad[2]}`) : e.message;
          io.stderr.write(`${ctx.shellName}: ${def.name}: ${shown}: invalid option\n`);
          io.stderr.write(`${def.name}: usage: ${help.split('\n')[0].replace(/^\w+: /, '')}\n`);
        } else {
          io.stderr.write(`${def.name}: ${e.message}\n`);
          io.stderr.write(`Try '${def.name} --help' for more information.\n`);
        }
        return def.usageStatus ?? 1;
      }
      if (opts.has('--help')) {
        io.stdout.write(help);
        return 0;
      }
      return def.run(opts, io, ctx);
    },
  };
}

/** Prefix for error messages: "ls: " or, for builtins, "bash: cd: ". */
export function errPrefix(name: string, ctx: ShellContext, builtin = false): string {
  return builtin ? `${ctx.shellName}: ${name}: ` : `${name}: `;
}

export function reason(e: unknown): string {
  if (e instanceof VfsError) return e.reason;
  throw e;
}

export interface InputFile {
  name: string;
  text: string;
  failed?: boolean;
}

/**
 * Read each operand (or stdin for none / `-`), reporting failures the way
 * cat/head/tail do. `onError` formats the message for a failed path.
 */
export function readInputs(
  operands: string[],
  io: IO,
  ctx: ShellContext,
  onError: (path: string, why: string, kind: 'open' | 'read') => string,
): InputFile[] {
  const list = operands.length ? operands : ['-'];
  const out: InputFile[] = [];
  for (const path of list) {
    if (path === '-') {
      out.push({ name: 'standard input', text: io.stdin });
      continue;
    }
    try {
      out.push({ name: path, text: ctx.vfs.readFile(path) });
    } catch (e) {
      const why = reason(e);
      const kind = e instanceof VfsError && e.code === 'EISDIR' ? 'read' : 'open';
      io.stderr.write(onError(path, why, kind) + '\n');
      out.push({ name: path, text: '', failed: true });
    }
  }
  return out;
}

/** Split text into lines, keeping each line's newline. A final unterminated line is kept. */
export function splitLines(text: string): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g);
  return lines ?? [];
}

/** Parse a non-negative count like head/tail do, with optional +/- sign handled by caller. */
export function parseCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

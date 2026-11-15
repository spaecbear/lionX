import type { Command } from './types';
import { defineCommand, readInputs, splitLines, type InputFile } from './util';

type Mode =
  | { kind: 'first'; n: number }
  | { kind: 'allButLast'; n: number }
  | { kind: 'last'; n: number }
  | { kind: 'from'; n: number };

/** GNU accepts the historical `head -5` / `tail -5` / `tail +5` forms as the first argument. */
function obsoleteCount(args: string[], allowPlus: boolean): string[] {
  const first = args[0];
  if (first !== undefined && /^-\d+$/.test(first)) return ['-n', first.slice(1), ...args.slice(1)];
  if (allowPlus && first !== undefined && /^\+\d+$/.test(first) && args.length <= 2) {
    return ['-n', first, ...args.slice(1)];
  }
  return args;
}

function select(text: string, mode: Mode): string {
  const lines = splitLines(text);
  switch (mode.kind) {
    case 'first':
      return lines.slice(0, mode.n).join('');
    case 'allButLast':
      return lines.slice(0, Math.max(0, lines.length - mode.n)).join('');
    case 'last':
      return mode.n === 0 ? '' : lines.slice(-mode.n).join('');
    case 'from':
      return lines.slice(Math.max(0, mode.n - 1)).join('');
  }
}

function makeHeadTail(name: 'head' | 'tail'): Command {
  const inner = defineCommand({
    name,
    unlockedInAct: 2,
    options: {
      flags: 'qv',
      withValue: 'n',
      long: {
        lines: { key: 'n', takesValue: true },
        quiet: { key: 'q' },
        silent: { key: 'q' },
        verbose: { key: 'v' },
      },
    },
    run(opts, io, ctx) {
      const raw = opts.values.get('n') ?? '10';
      let mode: Mode;
      const m = /^([+-]?)(\d+)$/.exec(raw);
      if (!m) {
        io.stderr.write(`${name}: invalid number of lines: '${raw}'\n`);
        return 1;
      }
      const n = Number(m[2]);
      if (name === 'head') mode = m[1] === '-' ? { kind: 'allButLast', n } : { kind: 'first', n };
      else mode = m[1] === '+' ? { kind: 'from', n } : { kind: 'last', n };

      const inputs: InputFile[] = readInputs(opts.operands, io, ctx, (p, why, kind) =>
        kind === 'read'
          ? `${name}: error reading '${p}': ${why}`
          : `${name}: cannot open '${p}' for reading: ${why}`,
      );
      // Headers: -v always, -q never, otherwise when more than one file.
      const headers = opts.flags.reduce(
        (h, f) => (f === 'v' ? true : f === 'q' ? false : h),
        inputs.length > 1,
      );
      let first = true;
      for (const f of inputs) {
        if (f.failed && f.text === '' && !ctx.vfs.isDir(f.name)) continue;
        if (headers) {
          io.stdout.write(`${first ? '' : '\n'}==> ${f.name} <==\n`);
        }
        first = false;
        if (!f.failed) io.stdout.write(select(f.text, mode));
      }
      return inputs.some((f) => f.failed) ? 1 : 0;
    },
  });
  return {
    ...inner,
    run: (args, io, ctx) => inner.run(obsoleteCount(args, name === 'tail'), io, ctx),
  };
}

export const head = makeHeadTail('head');
export const tail = makeHeadTail('tail');

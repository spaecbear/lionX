import type { Stat } from '../vfs';
import { isVfsError } from '../vfs';
import type { IO } from './types';
import { defineCommand, readInputs, reason, splitLines } from './util';

// ------------------------------------------------------------------ regex

/**
 * Convert a POSIX basic regular expression (grep's default) to a JS regex
 * source. In BRE, ( ) { } | + ? are literal unless backslashed.
 */
export function breToJs(bre: string): string {
  let out = '';
  for (let i = 0; i < bre.length; i++) {
    const c = bre[i];
    if (c === '\\' && i + 1 < bre.length) {
      const n = bre[++i];
      if ('(){}|+?'.includes(n)) out += n;
      else if (n === '<' || n === '>') out += '\\b';
      else out += '\\' + n;
    } else if ('(){}|+?'.includes(c)) {
      out += '\\' + c;
    } else if (c === '*' && (out === '' || out.endsWith('^') || out.endsWith('('))) {
      out += '\\*'; // a leading * is literal in BRE
    } else {
      out += c;
    }
  }
  return out;
}

/** ERE is close to JS; translate the few differences (\< \> word edges). */
function ereToJs(ere: string): string {
  return ere.replace(/\\[<>]/g, '\\b');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// ------------------------------------------------------------------- grep

interface GrepSettings {
  re: RegExp;
  invert: boolean;
  count: boolean;
  filesOnly: boolean;
  lineNumbers: boolean;
  onlyMatching: boolean;
  quiet: boolean;
  showNames: boolean;
}

function grepText(text: string, name: string, s: GrepSettings, io: IO): number {
  let matches = 0;
  const lines = splitLines(text);
  lines.forEach((raw, idx) => {
    const line = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    s.re.lastIndex = 0;
    const hit = s.re.test(line);
    if (hit === s.invert) return;
    matches++;
    if (s.quiet || s.count || s.filesOnly) return;
    const prefix = (s.showNames ? `${name}:` : '') + (s.lineNumbers ? `${idx + 1}:` : '');
    if (s.onlyMatching && !s.invert) {
      const g = new RegExp(s.re.source, s.re.flags.includes('g') ? s.re.flags : s.re.flags + 'g');
      for (const m of line.matchAll(g)) if (m[0]) io.stdout.write(`${prefix}${m[0]}\n`);
    } else {
      io.stdout.write(`${prefix}${line}\n`);
    }
  });
  if (s.count && !s.quiet) io.stdout.write(`${s.showNames ? `${name}:` : ''}${matches}\n`);
  if (s.filesOnly && matches > 0 && !s.quiet) io.stdout.write(`${name}\n`);
  return matches;
}

export const grep = defineCommand({
  name: 'grep',
  unlockedInAct: 4,
  usageStatus: 2,
  options: {
    flags: 'ivnclrRwxhHoqsEFG',
    withValue: 'e',
    long: {
      'ignore-case': { key: 'i' },
      'invert-match': { key: 'v' },
      'line-number': { key: 'n' },
      count: { key: 'c' },
      'files-with-matches': { key: 'l' },
      recursive: { key: 'r' },
      'word-regexp': { key: 'w' },
      'line-regexp': { key: 'x' },
      'no-filename': { key: 'h' },
      'with-filename': { key: 'H' },
      'only-matching': { key: 'o' },
      quiet: { key: 'q' },
      silent: { key: 'q' },
      'no-messages': { key: 's' },
      'extended-regexp': { key: 'E' },
      'fixed-strings': { key: 'F' },
      regexp: { key: 'e', takesValue: true },
    },
  },
  run(opts, io, ctx) {
    const operands = [...opts.operands];
    let pattern = opts.values.get('e');
    if (pattern === undefined) {
      if (operands.length === 0) {
        io.stderr.write(
          "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n",
        );
        return 2;
      }
      pattern = operands.shift()!;
    }
    const mode = opts.flags.filter((f) => 'EFG'.includes(f)).pop() ?? 'G';
    let src =
      mode === 'F' ? escapeRegex(pattern) : mode === 'E' ? ereToJs(pattern) : breToJs(pattern);
    if (opts.has('w')) src = `(?<![\\w])(?:${src})(?![\\w])`;
    if (opts.has('x')) src = `^(?:${src})$`;
    let re: RegExp;
    try {
      re = new RegExp(src, opts.has('i') ? 'i' : '');
    } catch {
      io.stderr.write(`grep: Invalid regular expression\n`);
      return 2;
    }
    const recursive = opts.has('r') || opts.has('R');
    if (operands.length === 0) operands.push(recursive ? '.' : '-');

    // Expand directories when recursive; names shown are as reached from the operand.
    const files: string[] = [];
    let errors = false;
    const quietErrors = opts.has('s');
    for (const op of operands) {
      if (op !== '-' && recursive && ctx.vfs.isDir(op)) {
        for (const st of ctx.vfs.walk(op, (e) => {
          if (!quietErrors) io.stderr.write(`grep: ${e.path}: ${e.reason}\n`);
          errors = true;
        })) {
          if (st.type !== 'file') continue;
          const rel = st.path.slice(ctx.vfs.resolve(op).length).replace(/^\//, '');
          files.push(
            op === '.' && operands.length === 1 && !opts.operands.includes('.')
              ? rel
              : `${op.replace(/\/+$/, '')}/${rel}`,
          );
        }
      } else files.push(op);
    }
    const multiple = files.length > 1 || recursive;
    const settings: GrepSettings = {
      re,
      invert: opts.has('v'),
      count: opts.has('c'),
      filesOnly: opts.has('l'),
      lineNumbers: opts.has('n'),
      onlyMatching: opts.has('o'),
      quiet: opts.has('q'),
      showNames: opts.flags.reduce((v, f) => (f === 'H' ? true : f === 'h' ? false : v), multiple),
    };
    let matched = false;
    for (const f of files) {
      let text: string;
      if (f === '-') text = io.stdin;
      else {
        try {
          text = ctx.vfs.readFile(f);
        } catch (e) {
          if (!quietErrors) io.stderr.write(`grep: ${f}: ${reason(e)}\n`);
          errors = true;
          continue;
        }
      }
      if (grepText(text, f === '-' ? '(standard input)' : f, settings, io) > 0) {
        matched = true;
        if (settings.quiet) return 0;
      }
    }
    if (errors && !(settings.quiet && matched)) return 2;
    return matched ? 0 : 1;
  },
});

// ------------------------------------------------------------------- find

type FindTest = (st: Stat, depth: number) => boolean;

/** Translate a shell glob (find -name) into a RegExp. */
function globRegex(glob: string, flags = ''): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) re += '\\[';
      else {
        let body = glob.slice(i + 1, end);
        if (body.startsWith('!')) body = '^' + body.slice(1);
        re += `[${body.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) re += escapeRegex(glob[++i]);
    else re += escapeRegex(c);
  }
  return new RegExp(`^${re}$`, flags + 's');
}

export const find = defineCommand({
  name: 'find',
  unlockedInAct: 4,
  options: { flags: '', stopAtOperand: true },
  run(opts, io, ctx) {
    const args = opts.operands;
    const paths: string[] = [];
    let i = 0;
    while (i < args.length && !args[i].startsWith('-') && args[i] !== '!' && args[i] !== '(')
      paths.push(args[i++]);
    if (paths.length === 0) paths.push('.');

    let maxDepth = Infinity;
    let minDepth = 0;
    const tests: FindTest[] = [];
    let negateNext = false;
    const push = (t: FindTest) => {
      const neg = negateNext;
      negateNext = false;
      tests.push(neg ? (s, d) => !t(s, d) : t);
    };
    const need = (flag: string) => {
      const v = args[++i];
      if (v === undefined) {
        io.stderr.write(`find: missing argument to \`${flag}'\n`);
        throw new Error('usage');
      }
      return v;
    };
    try {
      for (; i < args.length; i++) {
        const a = args[i];
        if (a === '!' || a === '-not') negateNext = !negateNext;
        else if (a === '-a' || a === '-and' || a === '-print') continue;
        else if (a === '-name' || a === '-iname') {
          const re = globRegex(need(a), a === '-iname' ? 'i' : '');
          push((s) => re.test(s.name));
        } else if (a === '-path') {
          const re = globRegex(need(a));
          push((s) => re.test(s.path));
        } else if (a === '-type') {
          const t = need(a);
          if (t !== 'f' && t !== 'd') {
            io.stderr.write(`find: Unknown argument to -type: ${t}\n`);
            return 1;
          }
          push((s) => (t === 'f' ? s.type === 'file' : s.type === 'dir'));
        } else if (a === '-empty') {
          push((s) => (s.type === 'file' ? s.size === 0 : ctx.vfs.readdir(s.path).length === 0));
        } else if (a === '-maxdepth' || a === '-mindepth') {
          const v = need(a);
          if (!/^\d+$/.test(v)) {
            io.stderr.write(
              `find: Expected a positive decimal integer argument to ${a}, but got '${v}'\n`,
            );
            return 1;
          }
          if (a === '-maxdepth') maxDepth = Number(v);
          else minDepth = Number(v);
        } else if (a === '-user') {
          const u = need(a);
          push((s) => s.owner === u);
        } else {
          io.stderr.write(`find: unknown predicate \`${a}'\n`);
          return 1;
        }
      }
    } catch {
      return 1;
    }

    let status = 0;
    for (const start of paths) {
      let root: Stat;
      try {
        root = ctx.vfs.stat(start);
      } catch (e) {
        io.stderr.write(`find: '${start}': ${reason(e)}\n`);
        status = 1;
        continue;
      }
      const base = start;
      const visit = (st: Stat, shown: string, depth: number) => {
        if (depth >= minDepth && tests.every((t) => t(st, depth))) io.stdout.write(shown + '\n');
        if (st.type !== 'dir' || depth >= maxDepth) return;
        let children: Stat[];
        try {
          children = ctx.vfs.list(st.path);
        } catch (e) {
          if (isVfsError(e)) {
            io.stderr.write(`find: '${shown}': ${e.reason}\n`);
            status = 1;
            return;
          }
          throw e;
        }
        for (const c of children)
          visit(c, shown.endsWith('/') ? shown + c.name : `${shown}/${c.name}`, depth + 1);
      };
      visit(root, base, 0);
    }
    return status;
  },
});

// --------------------------------------------------------------------- wc

interface Counts {
  lines: number;
  words: number;
  bytes: number;
  chars: number;
}

function count(text: string): Counts {
  return {
    lines: (text.match(/\n/g) ?? []).length,
    words: (text.match(/\S+/g) ?? []).length,
    bytes: new TextEncoder().encode(text).length,
    chars: [...text].length,
  };
}

export const wc = defineCommand({
  name: 'wc',
  unlockedInAct: 4,
  options: {
    flags: 'lwcm',
    long: { lines: { key: 'l' }, words: { key: 'w' }, bytes: { key: 'c' }, chars: { key: 'm' } },
  },
  run(opts, io, ctx) {
    const picked = (['l', 'w', 'm', 'c'] as const).filter((f) => opts.has(f));
    const fields: (keyof Counts)[] = (picked.length ? picked : (['l', 'w', 'c'] as const)).map(
      (f) => ({ l: 'lines', w: 'words', c: 'bytes', m: 'chars' })[f] as keyof Counts,
    );
    const inputs = readInputs(opts.operands, io, ctx, (p, why) => `wc: ${p}: ${why}`);
    const rows: { counts: Counts; name: string }[] = [];
    const total: Counts = { lines: 0, words: 0, bytes: 0, chars: 0 };
    for (const f of inputs) {
      if (f.failed) {
        if (ctx.vfs.isDir(f.name)) {
          rows.push({ counts: { lines: 0, words: 0, bytes: 0, chars: 0 }, name: f.name });
        }
        continue;
      }
      const c = count(f.text);
      for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += c[k];
      rows.push({ counts: c, name: opts.operands.length ? f.name : '' });
    }
    if (inputs.filter((f) => !f.failed).length > 1 || (inputs.length > 1 && rows.length > 1)) {
      rows.push({ counts: total, name: 'total' });
    }
    // GNU's width: digits of the total byte count over regular files, or 7 for standard input.
    const fromStdin = opts.operands.length === 0 || opts.operands.includes('-');
    let width = fromStdin
      ? 7
      : String(
          inputs.reduce((n, f) => n + (f.failed ? 0 : new TextEncoder().encode(f.text).length), 0),
        ).length;
    if (fields.length === 1 && rows.length === 1) width = 1;
    for (const r of rows) {
      const nums = fields.map((k) => String(r.counts[k]).padStart(width)).join(' ');
      io.stdout.write(r.name ? `${nums} ${r.name}\n` : `${nums}\n`);
    }
    return inputs.some((f) => f.failed) ? 1 : 0;
  },
});

// ------------------------------------------------------------------- sort

function numericPrefix(line: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(line);
  return m ? parseFloat(m[1]) : 0;
}

const byteCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const sort = defineCommand({
  name: 'sort',
  unlockedInAct: 4,
  options: {
    flags: 'rnufb',
    long: {
      reverse: { key: 'r' },
      'numeric-sort': { key: 'n' },
      unique: { key: 'u' },
      'ignore-case': { key: 'f' },
    },
  },
  run(opts, io, ctx) {
    const inputs = readInputs(
      opts.operands,
      io,
      ctx,
      (p, why) => `sort: cannot read: ${p}: ${why}`,
    );
    if (inputs.some((f) => f.failed)) return 2;
    const lines = inputs.flatMap((f) => splitLines(f.text).map((l) => l.replace(/\n$/, '')));
    const fold = opts.has('f');
    const key = (l: string) => {
      let k = opts.has('b') ? l.replace(/^\s+/, '') : l;
      if (fold) k = k.toUpperCase();
      return k;
    };
    const primary = (a: string, b: string) =>
      opts.has('n') ? numericPrefix(a) - numericPrefix(b) : byteCompare(key(a), key(b));
    // GNU falls back to comparing whole lines byte by byte when keys tie (unless -u).
    const cmp = (a: string, b: string) => primary(a, b) || (opts.has('u') ? 0 : byteCompare(a, b));
    let sorted = [...lines].sort(cmp);
    if (opts.has('r')) sorted.reverse();
    if (opts.has('u')) sorted = sorted.filter((l, i) => i === 0 || primary(sorted[i - 1], l) !== 0);
    io.stdout.write(sorted.map((l) => l + '\n').join(''));
    return 0;
  },
});

// ------------------------------------------------------------------- uniq

export const uniq = defineCommand({
  name: 'uniq',
  unlockedInAct: 4,
  options: {
    flags: 'cdui',
    long: {
      count: { key: 'c' },
      repeated: { key: 'd' },
      unique: { key: 'u' },
      'ignore-case': { key: 'i' },
    },
  },
  run(opts, io, ctx) {
    const [input, output] = opts.operands;
    const inputs = readInputs(
      input && input !== '-' ? [input] : [],
      io,
      ctx,
      (p, why) => `uniq: ${p}: ${why}`,
    );
    if (inputs[0].failed) return 1;
    const lines = splitLines(inputs[0].text).map((l) => l.replace(/\n$/, ''));
    const same = (a: string, b: string) =>
      opts.has('i') ? a.toLowerCase() === b.toLowerCase() : a === b;
    const groups: { line: string; n: number }[] = [];
    for (const l of lines) {
      const last = groups[groups.length - 1];
      if (last && same(last.line, l)) last.n++;
      else groups.push({ line: l, n: 1 });
    }
    let out = '';
    for (const g of groups) {
      if (opts.has('d') && g.n < 2) continue;
      if (opts.has('u') && g.n > 1) continue;
      out += (opts.has('c') ? `${String(g.n).padStart(7)} ` : '') + g.line + '\n';
    }
    if (output) {
      try {
        ctx.vfs.writeFile(output, out);
      } catch (e) {
        io.stderr.write(`uniq: ${output}: ${reason(e)}\n`);
        return 1;
      }
    } else io.stdout.write(out);
    return 0;
  },
});

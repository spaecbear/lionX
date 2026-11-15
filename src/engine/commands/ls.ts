import type { Stat } from '../vfs';
import type { IO, ShellContext } from './types';
import { defineCommand, reason } from './util';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIX_MONTHS_MS = (365.2425 / 2) * 24 * 60 * 60 * 1000;
const COLORS = { dir: '01;34', exec: '01;32' };

interface Entry {
  /** Name as displayed (operand as typed, or the directory entry name). */
  name: string;
  stat: Stat;
}

interface Settings {
  all: boolean;
  almostAll: boolean;
  long: boolean;
  human: boolean;
  onePerLine: boolean;
  columns: boolean;
  reverse: boolean;
  directory: boolean;
  classify: boolean;
  color: boolean;
  /** Terminal-style quoting of names with special characters. */
  quote: boolean;
  width: number;
  now: number;
  /** GNU resets attributes once, just before the first colored name. */
  colorStarted: boolean;
}

export function modeString(s: Stat): string {
  const t = s.type === 'dir' ? 'd' : '-';
  const bits = 'rwxrwxrwx';
  let out = t;
  for (let i = 0; i < 9; i++) out += s.mode & (1 << (8 - i)) ? bits[i] : '-';
  return out;
}

/** GNU `ls -h` sizes: 1-decimal under 10, rounded up, powers of 1024. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G', 'T', 'P'];
  let v = bytes / 1024;
  let u = 0;
  for (;;) {
    if (v < 10) {
      const r = Math.ceil(v * 10) / 10;
      if (r < 10) return `${r.toFixed(1)}${units[u]}`;
      v = r;
    }
    const r = Math.ceil(v);
    if (r < 1024 || u === units.length - 1) return `${r}${units[u]}`;
    v = r / 1024;
    u++;
  }
}

export function formatDate(ms: number, now: number): string {
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const recent = now - ms < SIX_MONTHS_MS && ms - now < 60 * 60 * 1000;
  const tail = recent
    ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    : ` ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${day} ${tail}`;
}

/** 1K blocks a file occupies on a 4K-block filesystem (what `total` sums). */
function blocks(s: Stat): number {
  return s.type === 'dir' ? 4 : Math.ceil(s.size / 4096) * 4;
}

const isExec = (s: Stat) => s.type === 'file' && (s.mode & 0o111) !== 0;

function needsQuote(name: string): boolean {
  return /[^A-Za-z0-9._\-+,/:@%^=~]/.test(name);
}

function quoteName(name: string): string {
  if (!name.includes("'")) return `'${name}'`;
  return `"${name.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** Plain-text display of a name (quoting and -F suffix), plus colored form. */
function display(e: Entry, st: Settings, anyQuoted: boolean): { plain: string; shown: string } {
  let name = e.name;
  if (st.quote && needsQuote(name)) name = quoteName(name);
  else if (st.quote && anyQuoted) name = ' ' + name;
  const suffix = st.classify ? (e.stat.type === 'dir' ? '/' : isExec(e.stat) ? '*' : '') : '';
  const code = st.color
    ? e.stat.type === 'dir'
      ? COLORS.dir
      : isExec(e.stat)
        ? COLORS.exec
        : ''
    : '';
  const lead = name.startsWith(' ') ? ' ' : '';
  const core = lead ? name.slice(1) : name;
  let reset = '';
  if (code && !st.colorStarted) {
    reset = '\x1b[0m';
    st.colorStarted = true;
  }
  return {
    plain: name + suffix,
    shown: lead + reset + (code ? `\x1b[${code}m${core}\x1b[0m` : core) + suffix,
  };
}

/** GNU's column layout: as many columns as fit, filled top to bottom. */
export function layoutColumns(items: { plain: string; shown: string }[], width: number): string {
  if (items.length === 0) return '';
  const n = items.length;
  let best = { cols: 1, rows: n, widths: [Math.max(...items.map((i) => i.plain.length))] };
  for (let cols = 2; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Skip layouts that would leave an empty trailing column.
    if (Math.ceil(n / rows) !== cols) continue;
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) {
      const col = items.slice(c * rows, c * rows + rows);
      widths.push(Math.max(...col.map((i) => i.plain.length)));
    }
    const total = widths.reduce((a, w) => a + w, 0) + 2 * (cols - 1);
    if (total <= width) best = { cols, rows, widths };
  }
  const lines: string[] = [];
  for (let r = 0; r < best.rows; r++) {
    let line = '';
    for (let c = 0; c < best.cols; c++) {
      const item = items[c * best.rows + r];
      if (!item) continue;
      const next = items[(c + 1) * best.rows + r];
      line += item.shown;
      if (next) line += ' '.repeat(best.widths[c] - item.plain.length + 2);
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

function formatLong(entries: Entry[], st: Settings, withTotal: boolean): string {
  const anyQuoted = st.quote && entries.some((e) => needsQuote(e.name));
  const sizes = entries.map((e) => (st.human ? humanSize(e.stat.size) : String(e.stat.size)));
  const w = {
    link: Math.max(0, ...entries.map((e) => String(e.stat.nlink).length)),
    owner: Math.max(0, ...entries.map((e) => e.stat.owner.length)),
    group: Math.max(0, ...entries.map((e) => e.stat.group.length)),
    size: Math.max(0, ...sizes.map((s) => s.length)),
  };
  let out = '';
  if (withTotal) {
    const total = entries.reduce((a, e) => a + blocks(e.stat), 0);
    out += `total ${st.human ? humanSize(total * 1024) : total}\n`;
  }
  entries.forEach((e, i) => {
    const s = e.stat;
    out +=
      [
        modeString(s),
        String(s.nlink).padStart(w.link),
        s.owner.padEnd(w.owner),
        s.group.padEnd(w.group),
        sizes[i].padStart(w.size),
        formatDate(s.mtime, st.now),
        display(e, st, anyQuoted).shown,
      ].join(' ') + '\n';
  });
  return out;
}

function formatEntries(entries: Entry[], st: Settings, withTotal: boolean): string {
  if (st.long) return formatLong(entries, st, withTotal);
  const anyQuoted = st.quote && entries.some((e) => needsQuote(e.name));
  const items = entries.map((e) => display(e, st, anyQuoted));
  if (st.onePerLine || !st.columns) return items.map((i) => i.shown + '\n').join('');
  return layoutColumns(items, st.width);
}

function sortEntries(entries: Entry[], reverse: boolean): Entry[] {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return reverse ? sorted.reverse() : sorted;
}

function readDir(path: string, st: Settings, io: IO, ctx: ShellContext): Entry[] | null {
  let stats: Stat[];
  try {
    stats = ctx.vfs.list(path);
  } catch (e) {
    io.stderr.write(`ls: cannot open directory '${path}': ${reason(e)}\n`);
    return null;
  }
  const entries: Entry[] = stats
    .filter((s) => st.all || st.almostAll || !s.name.startsWith('.'))
    .map((s) => ({ name: s.name, stat: s }));
  if (st.all) {
    const self = ctx.vfs.stat(path);
    const parentPath = self.path === '/' ? '/' : self.path.replace(/\/[^/]+$/, '') || '/';
    entries.push({ name: '.', stat: self }, { name: '..', stat: ctx.vfs.stat(parentPath) });
  }
  return sortEntries(entries, st.reverse);
}

/** GNU coreutils `ls`. */
export const ls = defineCommand({
  name: 'ls',
  unlockedInAct: 1,
  usageStatus: 2,
  options: {
    flags: 'aAlh1rdFC',
    long: {
      all: { key: 'a' },
      'almost-all': { key: 'A' },
      'human-readable': { key: 'h' },
      reverse: { key: 'r' },
      directory: { key: 'd' },
      classify: { key: 'F' },
      color: { key: 'color', optionalValue: true },
    },
  },
  run(opts, io, ctx) {
    const when = opts.values.get('color');
    if (
      when !== undefined &&
      !['always', 'auto', 'never', 'yes', 'no', 'tty', 'force', 'none', 'if-tty'].includes(when)
    ) {
      io.stderr.write(`ls: invalid argument '${when}' for '--color'\n`);
      io.stderr.write(
        "Valid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'\n",
      );
      io.stderr.write("Try 'ls --help' for more information.\n");
      return 1;
    }
    return runLs(opts.flags, opts.operands, opts.values, io, ctx);
  },
});

function runLs(
  flags: string[],
  operands: string[],
  values: Map<string, string>,
  io: IO,
  ctx: ShellContext,
): number {
  const tty = io.stdoutIsTerminal;
  const alias: Record<string, string> = {
    yes: 'always',
    force: 'always',
    no: 'never',
    none: 'never',
    tty: 'auto',
    'if-tty': 'auto',
  };
  const raw = values.get('color') ?? (flags.includes('color') ? 'always' : 'never');
  const colorWhen = alias[raw] ?? raw;
  const last = (a: string, b: string) => flags.lastIndexOf(a) > flags.lastIndexOf(b);
  const st: Settings = {
    all: flags.includes('a') && (!flags.includes('A') || last('a', 'A')),
    almostAll: flags.includes('A'),
    long: flags.includes('l'), // GNU: -1 never cancels -l
    human: flags.includes('h'),
    onePerLine: flags.includes('1'),
    columns: tty || flags.includes('C'),
    reverse: flags.includes('r'),
    directory: flags.includes('d'),
    classify: flags.includes('F'),
    color: colorWhen === 'always' || (colorWhen === 'auto' && tty),
    quote: tty,
    width: io.tty?.cols ?? (Number(ctx.env.get('COLUMNS')) || 80),
    now: ctx.vfs.now(),
    colorStarted: false,
  };

  let status = 0;
  const files: Entry[] = [];
  const dirs: Entry[] = [];
  const targets = operands.length ? operands : ['.'];
  for (const name of targets) {
    let stat: Stat;
    try {
      stat = ctx.vfs.stat(name);
    } catch (e) {
      io.stderr.write(`ls: cannot access '${name}': ${reason(e)}\n`);
      status = 2;
      continue;
    }
    (stat.type === 'dir' && !st.directory ? dirs : files).push({ name, stat });
  }

  const chunks: string[] = [];
  if (files.length) chunks.push(formatEntries(sortEntries(files, st.reverse), st, false));
  const showHeaders = targets.length > 1;
  for (const d of sortEntries(dirs, st.reverse)) {
    const entries = readDir(d.name, st, io, ctx);
    if (!entries) {
      status = 2;
      continue;
    }
    const header = showHeaders
      ? `${st.quote && needsQuote(d.name) ? quoteName(d.name) : d.name}:\n`
      : '';
    chunks.push(header + formatEntries(entries, st, true));
  }
  io.stdout.write(chunks.join('\n'));
  return status;
}

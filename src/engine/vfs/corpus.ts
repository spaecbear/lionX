/**
 * Generated text corpora: many plausible files from a short description,
 * so search puzzles have real haystacks. Deterministic for a given seed.
 */
export interface CorpusSpec {
  /** Directory to fill. */
  dir: string;
  count: number;
  /** File name pattern; {#} is the file number (1-based). Default "page-{#}". */
  name?: string;
  /** Lines per file. */
  lines: number;
  seed: number;
  /** Words to build lines from (defaults to a small archival vocabulary). */
  words?: string[];
  /** Exact lines to place in particular files (1-based numbers). */
  plant?: { line: string; files: number[] }[];
}

const DEFAULT_WORDS = [
  'the',
  'stars',
  'turned',
  'slowly',
  'over',
  'archive',
  'night',
  'lantern',
  'ink',
  'quiet',
  'page',
  'comet',
  'tide',
  'moth',
  'salt',
  'bell',
  'shelf',
  'dust',
  'chart',
  'north',
  'south',
  'faint',
  'bright',
  'seen',
  'again',
  'from',
  'tower',
  'glass',
  'cold',
  'and',
  'a',
  'of',
  'in',
  'was',
  'noted',
  'by',
  'keeper',
  'hour',
  'west',
  'east',
  'cloud',
  'clear',
  'still',
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Expand a corpus into a path -> content map. */
export function generateCorpus(raw: CorpusSpec): Record<string, string> {
  // Duty placeholders arrive as strings ("12"); accept them as numbers.
  const spec = {
    ...raw,
    count: Number(raw.count),
    lines: Number(raw.lines),
    seed: Number(raw.seed),
  };
  const next = rng(spec.seed);
  const words = spec.words?.length ? spec.words : DEFAULT_WORDS;
  const pattern = spec.name ?? 'page-{#}';
  const files: Record<string, string> = {};
  for (let n = 1; n <= spec.count; n++) {
    const lines: string[] = [];
    for (let l = 0; l < spec.lines; l++) {
      const len = 4 + Math.floor(next() * 7);
      const ws = Array.from({ length: len }, () => words[Math.floor(next() * words.length)]);
      ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
      lines.push(ws.join(' ') + '.');
    }
    for (const p of spec.plant ?? []) {
      if (p.files.map(Number).includes(n))
        lines.splice(Math.floor(next() * (lines.length + 1)), 0, p.line);
    }
    files[`${spec.dir.replace(/\/+$/, '')}/${pattern.replace('{#}', String(n))}`] =
      lines.join('\n') + '\n';
  }
  return files;
}

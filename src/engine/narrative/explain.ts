/**
 * The `solution` spell's explainer: takes a command line and says what each
 * piece does, from the glossary in src/content/glossary.yaml.
 */
import { parse } from 'yaml';

type FlagInfo = string | { says: string; takes?: boolean };
export interface Glossary {
  commands: Record<string, { says: string; flags?: Record<string, FlagInfo> }>;
  symbols: Record<string, string>;
  words: Record<string, string>;
}

export function loadGlossary(source: string): Glossary {
  const g = parse(source) as Glossary;
  if (!g?.commands || !g.symbols || !g.words)
    throw new Error('glossary.yaml: needs commands, symbols and words');
  for (const [name, c] of Object.entries(g.commands))
    if (typeof c?.says !== 'string') throw new Error(`glossary.yaml: ${name} needs says`);
  return g;
}

/** One piece of a command and what it does. */
export type Piece = [piece: string, says: string];

const SYMBOLS = ['2>>', '2>', '>>', '&&', '||', '|', '>', '<', ';', '&'];

/** Split a line into words and symbols, keeping quoted text whole. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) {
      i++;
      continue;
    }
    const sym = SYMBOLS.find((s) => line.startsWith(s, i));
    if (sym) {
      out.push(sym);
      i += sym.length;
      continue;
    }
    let word = '';
    while (i < line.length && !/\s/.test(line[i]) && !SYMBOLS.some((s) => line.startsWith(s, i))) {
      const q = line[i];
      if (q === '"' || q === "'") {
        const end = line.indexOf(q, i + 1);
        const stop = end < 0 ? line.length : end + 1;
        word += line.slice(i, stop);
        i = stop;
      } else word += line[i++];
    }
    out.push(word);
  }
  return out;
}

const flagText = (f: FlagInfo) => (typeof f === 'string' ? f : f.says);
const takes = (f: FlagInfo) => typeof f !== 'string' && !!f.takes;

/** What a plain word (not a spell or flag) is. */
function describeWord(w: string, g: Glossary): string {
  if (w === '/dev/null') return g.words['dev-null'];
  if (/^%\d+$/.test(w)) return g.words.job;
  if (w.startsWith('$')) return g.words.variable;
  if (w.startsWith('/')) return g.words.absolute;
  if (w.startsWith('~')) return g.words.home;
  if (w.includes('/')) return g.words.relative;
  return g.words.word;
}

/** Explain a whole command line, piece by piece. */
export function explain(line: string, g: Glossary): Piece[] {
  const out: Piece[] = [];
  let cmd: string | null = null;
  const tokens = tokenize(line);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (g.symbols[t] !== undefined) {
      // A redirection takes its target with it.
      const target = ['>', '>>', '<', '2>', '2>>'].includes(t) ? tokens[i + 1] : undefined;
      out.push([target ? `${t} ${target}` : t, g.symbols[t]]);
      if (target) {
        i++;
        if (target === '/dev/null') out.push(['/dev/null', g.words['dev-null']]);
      }
      if (!target) cmd = null;
      continue;
    }
    if (cmd === null || cmd === 'sudo') {
      const assign = /^[A-Za-z_]\w*=/.exec(t);
      if (assign && cmd === null) {
        out.push([t, `sets the variable ${assign[0].slice(0, -1)}`]);
        continue;
      }
      cmd = t;
      const known = g.commands[t];
      out.push([
        t,
        known ? known.says : t.includes('/') ? 'runs the ritual in that book' : 'a spell',
      ]);
      continue;
    }
    if (t === '--help') {
      out.push([t, g.words.help]);
      continue;
    }
    const flags = g.commands[cmd]?.flags ?? {};
    if (t.startsWith('-') && (t !== '-' || flags['-'] !== undefined)) {
      const f = flags[t];
      if (f !== undefined) {
        if (takes(f) && tokens[i + 1] !== undefined) {
          out.push([`${t} ${tokens[i + 1]}`, `${flagText(f)}: ${tokens[i + 1]}`]);
          i++;
        } else out.push([t, flagText(f)]);
        continue;
      }
      // Bundled single-letter flags, like -ri.
      const letters = /^-[A-Za-z]{2,}$/.test(t) ? [...t.slice(1)].map((c) => flags[`-${c}`]) : [];
      if (letters.length && letters.every((x) => x !== undefined)) {
        out.push([t, letters.map((x) => flagText(x!)).join('; ')]);
        continue;
      }
      out.push([t, 'a flag that changes what the spell does']);
      continue;
    }
    out.push([t, describeWord(t, g)]);
  }
  return out;
}

/** The commands a hint like "Type: a   then: b" asks for (Tab and password notes dropped). */
export function commandsFromHint(hint: string): string[] {
  const m = /Type(?: exactly)?:\s*(.+)$/.exec(hint);
  if (!m) return [];
  return m[1]
    .split(/\s+then:\s+/)
    .map((part) => part.split(/\s+then (?:press|enter)\b/)[0].trim())
    .filter(Boolean);
}

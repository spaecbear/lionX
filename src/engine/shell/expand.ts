import type { Vfs } from '../vfs';
import type { Word } from './ast';
import { expandGlob, hasGlobChars, unescapeGlob } from './glob';

export interface ExpandEnv {
  vfs: Vfs;
  env: Map<string, string>;
  lastStatus: number;
}

const GLOB_SPECIAL = /[*?[\]\\]/g;

function lookup(name: string, e: ExpandEnv): string {
  if (name === '?') return String(e.lastStatus);
  return e.env.get(name) ?? '';
}

/**
 * Expand a word into zero or more fields: tilde, then `$VAR`, then field
 * splitting of unquoted variables on whitespace, then globbing.
 */
export function expandWord(word: Word, e: ExpandEnv, opts: { glob?: boolean } = {}): string[] {
  // Each field is built as a glob pattern (quoted text escaped) plus a flag
  // that says whether it holds any quoted text, so "" survives as a field.
  const fields: { pattern: string; hadQuoted: boolean; started: boolean }[] = [];
  let cur = { pattern: '', hadQuoted: false, started: false };
  const flush = () => {
    if (cur.started) fields.push(cur);
    cur = { pattern: '', hadQuoted: false, started: false };
  };

  word.parts.forEach((part, idx) => {
    if (part.kind === 'lit') {
      let text = part.text;
      if (idx === 0 && !part.quoted && (text === '~' || text.startsWith('~/'))) {
        const home = e.env.get('HOME') ?? e.vfs.home;
        cur.pattern += home.replace(GLOB_SPECIAL, '\\$&');
        text = text.slice(1);
      }
      cur.pattern += part.quoted ? text.replace(GLOB_SPECIAL, '\\$&') : text;
      cur.started = true;
      if (part.quoted) cur.hadQuoted = true;
      return;
    }
    const value = lookup(part.name, e);
    if (part.quoted) {
      cur.pattern += value.replace(GLOB_SPECIAL, '\\$&');
      cur.started = true;
      cur.hadQuoted = true;
      return;
    }
    // Unquoted: split on whitespace. Glob characters in the value stay active.
    const pieces = value.split(/[ \t\n]+/);
    pieces.forEach((piece, i) => {
      if (i > 0) flush();
      if (piece !== '') {
        cur.pattern += piece.replace(/\\/g, '\\\\');
        cur.started = true;
      }
    });
  });
  flush();

  const out: string[] = [];
  for (const f of fields) {
    if (f.pattern === '' && !f.hadQuoted) continue;
    if (opts.glob !== false && hasGlobChars(f.pattern)) {
      const matches = expandGlob(f.pattern, e.vfs);
      if (matches.length) {
        out.push(...matches);
        continue;
      }
    }
    out.push(unescapeGlob(f.pattern));
  }
  return out;
}

/** Expand without splitting or globbing (assignment values, `[[ ]]`-like contexts). */
export function expandWordToString(word: Word, e: ExpandEnv): string {
  let s = '';
  word.parts.forEach((part, idx) => {
    if (part.kind === 'var') {
      s += lookup(part.name, e);
    } else if (idx === 0 && !part.quoted && (part.text === '~' || part.text.startsWith('~/'))) {
      s += (e.env.get('HOME') ?? e.vfs.home) + part.text.slice(1);
    } else {
      s += part.text;
    }
  });
  return s;
}

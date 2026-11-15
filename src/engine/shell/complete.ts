import type { Vfs } from '../vfs';

export interface CompletionResult {
  /** Index in the line where the word being completed starts. */
  start: number;
  /** Replacement for line.slice(start, cursor). Equal to the original word if nothing changed. */
  replacement: string;
  /** All matching names (display form) when the match is ambiguous; empty otherwise. */
  candidates: string[];
}

const OPERATOR_CHARS = '|&;<>';

/** Backslash-escape characters the shell would otherwise treat specially. */
export function escapeForShell(name: string): string {
  // `~` is left alone so completed paths like ~/notes keep expanding.
  return name.replace(/[\s'"\\$|&;<>*?[\]#`(){}!]/g, '\\$&');
}

/** Undo backslash escapes and strip quotes from a partial word. */
function unescapePartial(word: string): string {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '\\' && i + 1 < word.length) out += word[++i];
    else if (c !== '"' && c !== "'") out += c;
  }
  return out;
}

/** Find where the word under the cursor starts and whether it is in command position. */
function locateWord(line: string, cursor: number): { start: number; commandPosition: boolean } {
  let start = cursor;
  while (start > 0) {
    const c = line[start - 1];
    const escaped = start >= 2 && line[start - 2] === '\\';
    if ((/\s/.test(c) || OPERATOR_CHARS.includes(c)) && !escaped) break;
    start--;
  }
  // Command position: only whitespace or assignments since the last operator.
  let i = start - 1;
  while (i >= 0 && /\s/.test(line[i])) i--;
  const before = line.slice(0, i + 1);
  const lastOp = Math.max(...[...OPERATOR_CHARS].map((op) => before.lastIndexOf(op)));
  const between = before.slice(lastOp + 1).trim();
  const commandPosition =
    between === '' || between.split(/\s+/).every((w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  // A redirect target is a path, never a command.
  const prevChar = line[i];
  return { start, commandPosition: commandPosition && prevChar !== '>' && prevChar !== '<' };
}

function longestCommonPrefix(words: string[]): string {
  if (words.length === 0) return '';
  let prefix = words[0];
  for (const w of words) {
    while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

/**
 * Bash-style tab completion. Commands complete in command position (unless
 * the word contains a slash); everything else completes as a path. A unique
 * match gets a trailing `/` (directory) or space (file/command).
 */
export function complete(
  line: string,
  cursor: number,
  env: { vfs: Vfs; commands: string[]; home?: string },
): CompletionResult {
  const { start, commandPosition } = locateWord(line, cursor);
  const raw = line.slice(start, cursor);
  const word = unescapePartial(raw);
  const none: CompletionResult = { start, replacement: raw, candidates: [] };

  if (commandPosition && !word.includes('/')) {
    const matches = env.commands.filter((c) => c.startsWith(word));
    if (matches.length === 0) return none;
    if (matches.length === 1) return { start, replacement: matches[0] + ' ', candidates: [] };
    const lcp = longestCommonPrefix(matches);
    return lcp.length > word.length
      ? { start, replacement: lcp, candidates: [] }
      : { ...none, candidates: matches };
  }

  const slash = word.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
  const base = slash === -1 ? word : word.slice(slash + 1);
  const home = env.home ?? env.vfs.home;
  const dirForLookup =
    dirPart === ''
      ? '.'
      : dirPart === '~/' || dirPart.startsWith('~/')
        ? home + dirPart.slice(1)
        : dirPart;

  let names: string[];
  try {
    names = env.vfs.readdir(dirForLookup);
  } catch {
    return none;
  }
  const matches = names.filter(
    (n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')),
  );
  if (matches.length === 0) return none;

  const sep = dirForLookup.endsWith('/') ? '' : '/';
  const isDir = (n: string) => env.vfs.isDir(`${dirForLookup}${sep}${n}`);

  if (matches.length === 1) {
    const m = matches[0];
    const suffix = isDir(m) ? '/' : ' ';
    return {
      start,
      replacement: escapeForShell(dirPart) + escapeForShell(m) + suffix,
      candidates: [],
    };
  }
  const lcp = longestCommonPrefix(matches);
  if (lcp.length > base.length) {
    return { start, replacement: escapeForShell(dirPart) + escapeForShell(lcp), candidates: [] };
  }
  return { ...none, candidates: matches.map((m) => (isDir(m) ? m + '/' : m)) };
}

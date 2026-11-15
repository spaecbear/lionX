import { escapeForShell } from '../../engine/shell';
import type { Vfs } from '../../engine/vfs';

/** The whitespace-delimited word in `line` covering column `col`, or null on a space. */
export function wordAt(line: string, col: number): { word: string; start: number } | null {
  if (col < 0 || col >= line.length || /\s/.test(line[col])) return null;
  let start = col;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  let end = col;
  while (end < line.length && !/\s/.test(line[end])) end++;
  return { word: line.slice(start, end), start };
}

/**
 * Turn a tapped word from terminal output into text to insert, if it names
 * something that exists. Tries the word as written, without `ls -F` style
 * markers (`/ * @ =`), and without surrounding punctuation like quotes,
 * colons, and commas. Directories keep a trailing slash.
 */
export function tapInsertion(word: string, vfs: Vfs): string | null {
  const variants = new Set<string>([word]);
  const trimmed = word.replace(/^["'`([{<]+|["'`)\]}>,;:.]+$/g, '');
  variants.add(trimmed);
  for (const v of [...variants]) variants.add(v.replace(/[*@=|]$/, ''));
  for (const v of variants) {
    if (!v || v === '/' || v === '.' || v === '..') continue;
    // A bare "prompt-looking" word (user@host:~$) is never a path.
    if (/\$$|#$/.test(v)) continue;
    const bare = v.endsWith('/') ? v.slice(0, -1) : v;
    if (!vfs.exists(bare)) continue;
    const isDir = vfs.isDir(bare);
    return escapeForShell(bare) + (isDir ? '/' : '');
  }
  return null;
}

/** Text to insert so the tapped path doesn't run into the word before the cursor. */
export function withSeparator(insertion: string, textBeforeCursor: string): string {
  return textBeforeCursor === '' || /[\s/]$/.test(textBeforeCursor) ? insertion : ' ' + insertion;
}

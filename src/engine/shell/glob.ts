import type { Vfs } from '../vfs';

/**
 * Glob patterns use `\` to escape characters that were quoted on the command
 * line, so `"*".txt` becomes the pattern `\*.txt` and matches only literally.
 */

/** True if the pattern has an unescaped `*`, `?`, or `[...]`. */
export function hasGlobChars(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '*' || c === '?') return true;
    if (c === '[' && findBracketEnd(pattern, i) !== -1) return true;
  }
  return false;
}

/** Remove glob escapes, giving the literal text. */
export function unescapeGlob(pattern: string): string {
  return pattern.replace(/\\(.)/g, '$1');
}

function findBracketEnd(p: string, start: number): number {
  let j = start + 1;
  if (p[j] === '!' || p[j] === '^') j++;
  if (p[j] === ']') j++;
  for (; j < p.length; j++) {
    if (p[j] === '\\') j++;
    else if (p[j] === ']') return j;
  }
  return -1;
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Compile one path segment of a glob into an anchored RegExp. */
export function segmentToRegExp(seg: string): RegExp {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '\\' && i + 1 < seg.length) {
      re += reEscape(seg[++i]);
    } else if (c === '*') {
      re += '.*';
    } else if (c === '?') {
      re += '.';
    } else if (c === '[') {
      const end = findBracketEnd(seg, i);
      if (end === -1) {
        re += '\\[';
        continue;
      }
      let body = seg.slice(i + 1, end);
      let negate = false;
      if (body[0] === '!' || body[0] === '^') {
        negate = true;
        body = body.slice(1);
      }
      const cls = body.replace(/\\(.)/g, '$1').replace(/[\\\]^]/g, '\\$&');
      re += `[${negate ? '^' : ''}${cls}]`;
      i = end;
    } else {
      re += reEscape(c);
    }
  }
  return new RegExp(`^${re}$`, 's');
}

/**
 * Expand a glob against the VFS. Returns matches sorted (C locale), or an
 * empty array when nothing matches (the caller keeps the word literal, like
 * Bash without nullglob). Hidden names match only if the segment starts with
 * a literal dot. Unreadable directories simply contribute no matches.
 */
export function expandGlob(pattern: string, vfs: Vfs): string[] {
  const absolute = pattern.startsWith('/');
  const trailingSlash = pattern.endsWith('/');
  const segs = pattern.split('/').filter((s) => s.length > 0);
  // Each candidate: [display path, absolute path]
  let candidates: [string, string][] = [[absolute ? '/' : '', absolute ? '/' : vfs.cwd]];

  segs.forEach((seg, idx) => {
    const last = idx === segs.length - 1;
    const next: [string, string][] = [];
    for (const [shown, abs] of candidates) {
      const join = (base: string, name: string) =>
        base === '' ? name : base.endsWith('/') ? base + name : `${base}/${name}`;
      if (!hasGlobChars(seg)) {
        const name = unescapeGlob(seg);
        next.push([join(shown, name), join(abs, name)]);
        continue;
      }
      let names: string[];
      try {
        names = vfs.readdir(abs);
      } catch {
        continue;
      }
      const re = segmentToRegExp(seg);
      const allowHidden = seg.startsWith('.') || seg.startsWith('\\.');
      for (const n of names) {
        if (n.startsWith('.') && !allowHidden) continue;
        if (!re.test(n)) continue;
        const childAbs = join(abs, n);
        if ((!last || trailingSlash) && !vfs.isDir(childAbs)) continue;
        next.push([join(shown, n), childAbs]);
      }
    }
    candidates = next;
  });

  return candidates
    .filter(([, abs]) => vfs.exists(abs))
    .map(([shown]) => (trailingSlash ? shown + '/' : shown))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

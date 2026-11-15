/**
 * Pure path helpers. Resolution is logical (like Bash `cd` without -P): `..` is
 * applied lexically. The VFS has no symlinks yet, so logical and physical agree.
 */

/** Split an absolute or relative path into non-empty segments ("a//b/" -> ["a","b"]). */
export function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Expand a leading `~` or `~/` to `home`. `~user` forms are left untouched. */
export function expandTilde(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return home + path.slice(1);
  return path;
}

/**
 * Resolve `path` against `cwd` (and `home` for `~`) to a normalized absolute path.
 * `..` at `/` stays at `/`. The empty string resolves to `cwd`.
 */
export function resolvePath(path: string, cwd: string, home: string): string {
  const expanded = expandTilde(path, home);
  const start = expanded.startsWith('/') ? [] : splitPath(cwd);
  const out = [...start];
  for (const seg of splitPath(expanded)) {
    if (seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

/** Parent directory of a normalized absolute path. dirname("/") is "/". */
export function dirname(abs: string): string {
  const segs = splitPath(abs);
  segs.pop();
  return '/' + segs.join('/');
}

/** Last segment of a path, ignoring trailing slashes. basename("/") is "/". */
export function basename(path: string): string {
  const segs = splitPath(path);
  return segs.length === 0 ? '/' : segs[segs.length - 1];
}

/** Join path pieces and normalize slashes (no `..` processing). */
export function joinPath(...parts: string[]): string {
  const abs = parts[0]?.startsWith('/') ?? false;
  const joined = parts.flatMap(splitPath).join('/');
  return abs ? '/' + joined : joined;
}

/** True when `abs` is `ancestor` or lies beneath it. Both must be normalized absolute paths. */
export function isWithin(abs: string, ancestor: string): boolean {
  if (ancestor === '/') return true;
  return abs === ancestor || abs.startsWith(ancestor + '/');
}

/** Hidden entries start with a dot (the secret passages of the Archive). */
export function isHidden(name: string): boolean {
  return name.startsWith('.');
}

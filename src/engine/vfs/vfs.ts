import { VfsError, type ErrnoCode } from './errors';
import { basename, dirname, isWithin, resolvePath, splitPath } from './path';

/**
 * In-memory filesystem for the Archive.
 *
 * Paths given to public methods may be absolute or relative; relative paths
 * resolve against `cwd`, and `~` against `home`. Every operation checks
 * permissions for the current credentials and throws a {@link VfsError}
 * carrying an errno code and the path exactly as the caller wrote it.
 *
 * Deliberate simplifications (documented so commands can rely on them):
 * - No symlinks, hard links, or devices yet. `..` is resolved lexically.
 * - `root` bypasses read/write checks, and execute checks on directories; it
 *   needs at least one execute bit to "execute" a file (same as Linux).
 * - Removing or moving the current directory (or one of its ancestors) is
 *   refused with EBUSY so the player's prompt can never point at nothing.
 */

export type NodeType = 'file' | 'dir';

interface BaseNode {
  owner: string;
  group: string;
  /** Permission bits only, e.g. 0o755. */
  mode: number;
  atime: number;
  mtime: number;
  ctime: number;
}

export interface FileNode extends BaseNode {
  type: 'file';
  content: string;
}

export interface DirNode extends BaseNode {
  type: 'dir';
  children: Map<string, Node>;
}

export type Node = FileNode | DirNode;

export interface Credentials {
  user: string;
  /** Primary group first. */
  groups: string[];
}

export interface Stat {
  name: string;
  path: string;
  type: NodeType;
  size: number;
  mode: number;
  owner: string;
  group: string;
  atime: number;
  mtime: number;
  ctime: number;
  /** Directory: number of subdirectories + 2. File: 1. Matches `ls -l` link counts. */
  nlink: number;
}

export interface VfsOptions {
  /** Clock in epoch milliseconds. Inject a fixed clock for deterministic tests. */
  now?: () => number;
  credentials?: Credentials;
  home?: string;
  cwd?: string;
  umask?: number;
}

const R = 4;
const W = 2;
const X = 1;
export const DIR_BLOCK_SIZE = 4096;
const SNAPSHOT_VERSION = 1;

/** JSON-safe form of a node. */
export type SerializedNode =
  | (Omit<FileNode, never> & { type: 'file' })
  | (Omit<DirNode, 'children'> & { type: 'dir'; children: Record<string, SerializedNode> });

export interface VfsSnapshot {
  version: number;
  root: SerializedNode;
  cwd: string;
  home: string;
  credentials: Credentials;
  umask: number;
}

const encoder = new TextEncoder();

export class Vfs {
  private root: DirNode;
  /** The world clock (epoch ms). */
  readonly now: () => number;
  credentials: Credentials;
  home: string;
  umask: number;
  private _cwd: string;

  constructor(opts: VfsOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.credentials = opts.credentials ?? { user: 'root', groups: ['root'] };
    this.home = opts.home ?? '/';
    this.umask = opts.umask ?? 0o022;
    this._cwd = '/';
    const t = this.now();
    this.root = {
      type: 'dir',
      owner: 'root',
      group: 'root',
      mode: 0o755,
      atime: t,
      mtime: t,
      ctime: t,
      children: new Map(),
    };
    if (opts.cwd) this._cwd = resolvePath(opts.cwd, '/', this.home);
  }

  // ---------------------------------------------------------------- session

  get cwd(): string {
    return this._cwd;
  }

  get isRoot(): boolean {
    return this.credentials.user === 'root';
  }

  /** Normalize a user path to an absolute path (no filesystem access). */
  resolve(path: string): string {
    return resolvePath(path, this._cwd, this.home);
  }

  /** Change directory, like `cd`. Needs the target to be a searchable directory. */
  chdir(path: string): string {
    const abs = this.resolve(path);
    const node = this.lookup(path);
    if (node.type !== 'dir') throw new VfsError('ENOTDIR', path);
    this.requirePerm(node, X, path);
    this._cwd = abs;
    return abs;
  }

  // ------------------------------------------------------------ inspection

  exists(path: string): boolean {
    try {
      this.lookup(path);
      return true;
    } catch {
      return false;
    }
  }

  isDir(path: string): boolean {
    try {
      return this.lookup(path).type === 'dir';
    } catch {
      return false;
    }
  }

  isFile(path: string): boolean {
    try {
      return this.lookup(path).type === 'file';
    } catch {
      return false;
    }
  }

  stat(path: string): Stat {
    const node = this.lookup(path);
    return this.makeStat(node, this.resolve(path));
  }

  /** Names in a directory, sorted, including hidden entries (not `.` / `..`). Needs read. */
  readdir(path: string): string[] {
    const dir = this.lookupDir(path);
    this.requirePerm(dir, R, path);
    return [...dir.children.keys()].sort(compareNames);
  }

  /** Like readdir, but returns a Stat per entry. Needs read and search on the directory. */
  list(path: string): Stat[] {
    const abs = this.resolve(path);
    const dir = this.lookupDir(path);
    this.requirePerm(dir, R, path);
    this.requirePerm(dir, X, path);
    return [...dir.children.entries()]
      .sort(([a], [b]) => compareNames(a, b))
      .map(([name, node]) => this.makeStat(node, abs === '/' ? `/${name}` : `${abs}/${name}`));
  }

  /**
   * Depth-first walk yielding the start path then every descendant, pre-order,
   * children sorted. Unreadable directories are yielded but not descended into
   * (their error is reported via `onError`), mirroring `find`.
   */
  *walk(path: string, onError?: (e: VfsError) => void): Generator<Stat> {
    const start = this.stat(path);
    yield start;
    if (start.type === 'dir') yield* this.walkDir(start.path, onError);
  }

  private *walkDir(abs: string, onError?: (e: VfsError) => void): Generator<Stat> {
    let entries: Stat[];
    try {
      entries = this.list(abs);
    } catch (e) {
      if (e instanceof VfsError) onError?.(e);
      else throw e;
      return;
    }
    for (const s of entries) {
      yield s;
      if (s.type === 'dir') yield* this.walkDir(s.path, onError);
    }
  }

  // -------------------------------------------------------------- reading

  readFile(path: string): string {
    const node = this.lookup(path);
    if (node.type === 'dir') throw new VfsError('EISDIR', path);
    this.requirePerm(node, R, path);
    node.atime = this.now();
    return node.content;
  }

  // -------------------------------------------------------------- writing

  /** Create or truncate a file and write `content` (like `>`). */
  writeFile(path: string, content: string): void {
    this.writeOrAppend(path, content, false);
  }

  /** Append to a file, creating it if needed (like `>>`). */
  appendFile(path: string, content: string): void {
    this.writeOrAppend(path, content, true);
  }

  /** Create a new empty file. Fails with EEXIST if anything is already there. */
  createFile(path: string, content = ''): void {
    const { parent, name } = this.parentForCreate(path);
    if (parent.children.has(name)) throw new VfsError('EEXIST', path);
    this.requireDirWrite(parent, path);
    this.insert(parent, name, this.newFile(content));
  }

  /** `touch`: create an empty file, or bump mtime/atime on an existing node. */
  touch(path: string): void {
    const existing = this.tryLookup(path);
    if (!existing) {
      this.createFile(path);
      return;
    }
    if (!this.isRoot && existing.owner !== this.credentials.user) {
      this.requirePerm(existing, W, path);
    }
    const t = this.now();
    existing.atime = t;
    existing.mtime = t;
    existing.ctime = t;
  }

  /** `mkdir`. With `parents`, creates missing ancestors and tolerates an existing directory. */
  mkdir(path: string, opts: { parents?: boolean; mode?: number } = {}): void {
    const mode = (opts.mode ?? 0o777) & ~this.umask;
    if (!opts.parents) {
      const { parent, name } = this.parentForCreate(path);
      if (parent.children.has(name)) throw new VfsError('EEXIST', path);
      this.requireDirWrite(parent, path);
      this.insert(parent, name, this.newDir(mode));
      return;
    }
    const abs = this.resolve(path);
    let dir = this.root;
    let walked = '';
    for (const seg of splitPath(abs)) {
      walked += '/' + seg;
      this.requirePerm(dir, X, walked);
      const child = dir.children.get(seg);
      if (child) {
        if (child.type !== 'dir') {
          throw new VfsError(walked === abs ? 'EEXIST' : 'ENOTDIR', path);
        }
        dir = child;
        continue;
      }
      this.requirePerm(dir, W, path);
      const created = this.newDir(mode);
      this.insert(dir, seg, created);
      dir = created;
    }
  }

  // ------------------------------------------------------------- removing

  /** Remove a file (`unlink`). Directories fail with EISDIR. */
  unlink(path: string): void {
    const { parent, name, node } = this.lookupWithParent(path);
    if (node.type === 'dir') throw new VfsError('EISDIR', path);
    this.requireDirWrite(parent, path);
    this.detach(parent, name);
  }

  /** Remove an empty directory (`rmdir`). */
  rmdir(path: string): void {
    const abs = this.resolve(path);
    if (abs === '/') throw new VfsError('EBUSY', path);
    const { parent, name, node } = this.lookupWithParent(path);
    if (node.type !== 'dir') throw new VfsError('ENOTDIR', path);
    if (node.children.size > 0) throw new VfsError('ENOTEMPTY', path);
    if (isWithin(this._cwd, abs)) throw new VfsError('EBUSY', path);
    this.requireDirWrite(parent, path);
    this.detach(parent, name);
  }

  /**
   * Remove a file, or a directory tree with `recursive` (like `rm` / `rm -r`).
   * The whole tree is permission-checked before anything is removed, so a
   * denied removal leaves the world untouched.
   */
  remove(path: string, opts: { recursive?: boolean } = {}): void {
    const abs = this.resolve(path);
    if (abs === '/') throw new VfsError('EPERM', path);
    const { parent, name, node } = this.lookupWithParent(path);
    if (node.type === 'file') {
      this.requireDirWrite(parent, path);
      this.detach(parent, name);
      return;
    }
    if (!opts.recursive) throw new VfsError('EISDIR', path);
    if (isWithin(this._cwd, abs)) throw new VfsError('EBUSY', path);
    this.requireDirWrite(parent, path);
    this.checkTreeRemovable(node, abs);
    this.detach(parent, name);
  }

  private checkTreeRemovable(dir: DirNode, abs: string): void {
    if (dir.children.size === 0) return;
    this.requirePerm(dir, R, abs);
    this.requireDirWrite(dir, abs);
    for (const [name, child] of dir.children) {
      if (child.type === 'dir') this.checkTreeRemovable(child, `${abs}/${name}`);
    }
  }

  // ------------------------------------------------------- moving/copying

  /**
   * Rename `src` to exactly `dst` (rename(2) semantics; `mv` decides whether
   * `dst` means "into this directory"). An existing file at `dst` is replaced;
   * an existing directory at `dst` is replaced only if `src` is a directory and
   * `dst` is empty.
   */
  move(src: string, dst: string): void {
    const srcAbs = this.resolve(src);
    const dstAbs = this.resolve(dst);
    const s = this.lookupWithParent(src);
    if (srcAbs === dstAbs) return;
    if (srcAbs === '/' || isWithin(this._cwd, srcAbs)) throw new VfsError('EBUSY', src);
    if (isWithin(dstAbs, srcAbs)) throw new VfsError('EINVAL', dst);
    const d = this.parentForCreate(dst);
    const existing = d.parent.children.get(d.name);
    if (existing) {
      if (s.node.type === 'file' && existing.type === 'dir') throw new VfsError('EISDIR', dst);
      if (s.node.type === 'dir' && existing.type === 'file') throw new VfsError('ENOTDIR', dst);
      if (existing.type === 'dir' && existing.children.size > 0) {
        throw new VfsError('ENOTEMPTY', dst);
      }
    }
    this.requireDirWrite(s.parent, src);
    this.requireDirWrite(d.parent, dst);
    this.detach(s.parent, s.name);
    if (existing) d.parent.children.delete(d.name);
    this.insert(d.parent, d.name, s.node);
    s.node.ctime = this.now();
  }

  /**
   * Copy `src` to exactly `dst` (`cp` decides "into directory"). Directories
   * need `recursive`. New nodes belong to the caller and take the source mode
   * masked by umask; overwriting an existing file keeps that file's metadata.
   * Fails before writing anything if any source is unreadable.
   */
  copy(src: string, dst: string, opts: { recursive?: boolean } = {}): void {
    const srcAbs = this.resolve(src);
    const dstAbs = this.resolve(dst);
    const node = this.lookup(src);
    if (node.type === 'dir' && !opts.recursive) throw new VfsError('EISDIR', src);
    if (srcAbs === dstAbs) throw new VfsError('EINVAL', dst);
    if (node.type === 'dir' && isWithin(dstAbs, srcAbs)) throw new VfsError('EINVAL', dst);
    this.checkTreeReadable(node, src);
    const d = this.parentForCreate(dst);
    const existing = d.parent.children.get(d.name);
    if (existing) {
      if (node.type === 'file') {
        if (existing.type === 'dir') throw new VfsError('EISDIR', dst);
        this.requirePerm(existing, W, dst);
        existing.content = node.content;
        existing.mtime = existing.ctime = this.now();
        return;
      }
      if (existing.type === 'file') throw new VfsError('ENOTDIR', dst);
      // Directory onto existing directory: merge, like `cp -r a b` when b/a exists.
      this.copyChildrenInto(node, existing, dst);
      return;
    }
    this.requireDirWrite(d.parent, dst);
    this.insert(d.parent, d.name, this.cloneTree(node));
  }

  private copyChildrenInto(srcDir: DirNode, dstDir: DirNode, dstPath: string): void {
    this.requireDirWrite(dstDir, dstPath);
    for (const [name, child] of srcDir.children) {
      const target = dstDir.children.get(name);
      const childPath = `${dstPath}/${name}`;
      if (!target) {
        this.insert(dstDir, name, this.cloneTree(child));
      } else if (child.type === 'dir' && target.type === 'dir') {
        this.copyChildrenInto(child, target, childPath);
      } else if (child.type === 'file' && target.type === 'file') {
        this.requirePerm(target, W, childPath);
        target.content = child.content;
        target.mtime = target.ctime = this.now();
      } else {
        throw new VfsError(child.type === 'dir' ? 'ENOTDIR' : 'EISDIR', childPath);
      }
    }
  }

  private checkTreeReadable(node: Node, path: string): void {
    this.requirePerm(node, R, path);
    if (node.type === 'dir') {
      this.requirePerm(node, X, path);
      for (const [name, child] of node.children) this.checkTreeReadable(child, `${path}/${name}`);
    }
  }

  private cloneTree(node: Node): Node {
    const mode = node.mode & ~this.umask;
    if (node.type === 'file') {
      const f = this.newFile(node.content);
      f.mode = mode;
      return f;
    }
    const d = this.newDir(mode);
    for (const [name, child] of node.children) d.children.set(name, this.cloneTree(child));
    return d;
  }

  // ---------------------------------------------------------- permissions

  /** `chmod`: only the owner or root may change mode bits. */
  chmod(path: string, mode: number): void {
    const node = this.lookup(path);
    if (!this.isRoot && node.owner !== this.credentials.user) throw new VfsError('EPERM', path);
    node.mode = mode & 0o7777;
    node.ctime = this.now();
  }

  /** `chown`: only root may change ownership. Either part may be omitted. */
  chown(path: string, owner?: string, group?: string): void {
    const node = this.lookup(path);
    if (!this.isRoot) throw new VfsError('EPERM', path);
    if (owner !== undefined) node.owner = owner;
    if (group !== undefined) node.group = group;
    node.ctime = this.now();
  }

  /** True if the current credentials have read/write/execute access to `path`. */
  access(path: string, want: 'r' | 'w' | 'x'): boolean {
    try {
      const node = this.lookup(path);
      return this.hasPerm(node, want === 'r' ? R : want === 'w' ? W : X);
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------- serialization

  serialize(): VfsSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      root: serializeNode(this.root) as SerializedNode,
      cwd: this._cwd,
      home: this.home,
      credentials: { user: this.credentials.user, groups: [...this.credentials.groups] },
      umask: this.umask,
    };
  }

  toJSON(): VfsSnapshot {
    return this.serialize();
  }

  static load(snapshot: VfsSnapshot | string, opts: Pick<VfsOptions, 'now'> = {}): Vfs {
    const snap: VfsSnapshot = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    if (snap.version !== SNAPSHOT_VERSION) {
      throw new Error(`Unsupported VFS snapshot version: ${snap.version}`);
    }
    if (snap.root?.type !== 'dir') throw new Error('VFS snapshot root must be a directory');
    const vfs = new Vfs({
      now: opts.now,
      credentials: snap.credentials,
      home: snap.home,
      umask: snap.umask,
    });
    vfs.root = deserializeNode(snap.root) as DirNode;
    vfs._cwd = vfs.isDir(snap.cwd) ? vfs.resolve(snap.cwd) : '/';
    return vfs;
  }

  // ------------------------------------------------------------ internals

  private lookup(path: string): Node {
    return this.lookupWithParent(path).node;
  }

  private tryLookup(path: string): Node | undefined {
    try {
      return this.lookup(path);
    } catch (e) {
      if (e instanceof VfsError && e.code === 'ENOENT') return undefined;
      throw e;
    }
  }

  private lookupDir(path: string): DirNode {
    const node = this.lookup(path);
    if (node.type !== 'dir') throw new VfsError('ENOTDIR', path);
    return node;
  }

  /**
   * Walk to `path`, checking search permission on each directory passed through.
   * A trailing slash on a file fails with ENOTDIR, like the kernel.
   */
  private lookupWithParent(path: string): { parent: DirNode; name: string; node: Node } {
    const abs = this.resolve(path);
    const segs = splitPath(abs);
    let parent = this.root;
    let node: Node = this.root;
    for (const seg of segs) {
      if (node.type !== 'dir') throw new VfsError('ENOTDIR', path);
      this.requirePerm(node, X, path);
      parent = node;
      const child: Node | undefined = node.children.get(seg);
      if (!child) throw new VfsError('ENOENT', path);
      node = child;
    }
    if (node.type === 'file' && /\/\.?$/.test(path)) throw new VfsError('ENOTDIR', path);
    return { parent, name: segs[segs.length - 1] ?? '/', node };
  }

  /** Locate the parent directory for creating `path`, enforcing that it exists. */
  private parentForCreate(path: string): { parent: DirNode; name: string } {
    const abs = this.resolve(path);
    if (abs === '/') throw new VfsError('EEXIST', path);
    const parentAbs = dirname(abs);
    let parent: Node;
    try {
      parent = this.lookup(parentAbs);
    } catch (e) {
      if (e instanceof VfsError) throw new VfsError(e.code, path);
      throw e;
    }
    if (parent.type !== 'dir') throw new VfsError('ENOTDIR', path);
    this.requirePerm(parent, X, path);
    return { parent, name: basename(abs) };
  }

  private writeOrAppend(path: string, content: string, append: boolean): void {
    const existing = this.tryLookup(path);
    if (existing) {
      if (existing.type === 'dir') throw new VfsError('EISDIR', path);
      this.requirePerm(existing, W, path);
      existing.content = append ? existing.content + content : content;
      existing.mtime = existing.ctime = this.now();
      return;
    }
    if (/\/$/.test(path)) throw new VfsError('EISDIR', path);
    const { parent, name } = this.parentForCreate(path);
    this.requireDirWrite(parent, path);
    this.insert(parent, name, this.newFile(content));
  }

  private insert(parent: DirNode, name: string, node: Node): void {
    parent.children.set(name, node);
    parent.mtime = parent.ctime = this.now();
  }

  private detach(parent: DirNode, name: string): void {
    parent.children.delete(name);
    parent.mtime = parent.ctime = this.now();
  }

  private newFile(content: string): FileNode {
    const t = this.now();
    return {
      type: 'file',
      owner: this.credentials.user,
      group: this.credentials.groups[0] ?? this.credentials.user,
      mode: 0o666 & ~this.umask,
      atime: t,
      mtime: t,
      ctime: t,
      content,
    };
  }

  private newDir(mode: number): DirNode {
    const t = this.now();
    return {
      type: 'dir',
      owner: this.credentials.user,
      group: this.credentials.groups[0] ?? this.credentials.user,
      mode,
      atime: t,
      mtime: t,
      ctime: t,
      children: new Map(),
    };
  }

  private hasPerm(node: Node, bit: number): boolean {
    if (this.isRoot) {
      if (bit !== X || node.type === 'dir') return true;
      return (node.mode & 0o111) !== 0;
    }
    let shift = 0;
    if (node.owner === this.credentials.user) shift = 6;
    else if (this.credentials.groups.includes(node.group)) shift = 3;
    return ((node.mode >> shift) & bit) !== 0;
  }

  private requirePerm(node: Node, bit: number, path: string): void {
    if (!this.hasPerm(node, bit)) throw new VfsError('EACCES', path);
  }

  /** Creating or deleting an entry needs write and search on the directory. */
  private requireDirWrite(dir: DirNode, path: string): void {
    this.requirePerm(dir, W, path);
    this.requirePerm(dir, X, path);
  }

  private makeStat(node: Node, abs: string): Stat {
    return {
      name: basename(abs),
      path: abs,
      type: node.type,
      size: node.type === 'file' ? encoder.encode(node.content).length : DIR_BLOCK_SIZE,
      mode: node.mode,
      owner: node.owner,
      group: node.group,
      atime: node.atime,
      mtime: node.mtime,
      ctime: node.ctime,
      nlink:
        node.type === 'file'
          ? 1
          : 2 + [...node.children.values()].filter((c) => c.type === 'dir').length,
    };
  }
}

/** Byte-order name comparison (LC_ALL=C), which is what the game uses for `ls`. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serializeNode(node: Node): SerializedNode {
  if (node.type === 'file') return { ...node };
  const children: Record<string, SerializedNode> = Object.create(null);
  for (const [name, child] of node.children) children[name] = serializeNode(child);
  const { children: _omit, ...rest } = node;
  void _omit;
  return { ...rest, children };
}

function deserializeNode(s: SerializedNode): Node {
  const base = {
    owner: String(s.owner),
    group: String(s.group),
    mode: Number(s.mode) & 0o7777,
    atime: Number(s.atime),
    mtime: Number(s.mtime),
    ctime: Number(s.ctime),
  };
  if (s.type === 'file') return { type: 'file', ...base, content: String(s.content) };
  if (s.type !== 'dir') throw new Error(`Unknown node type in snapshot: ${(s as Node).type}`);
  const children = new Map<string, Node>();
  for (const name of Object.keys(s.children)) {
    if (!Object.prototype.hasOwnProperty.call(s.children, name)) continue;
    if (name === '' || name === '.' || name === '..' || name.includes('/')) {
      throw new Error(`Invalid entry name in snapshot: ${JSON.stringify(name)}`);
    }
    children.set(name, deserializeNode(s.children[name]));
  }
  return { type: 'dir', ...base, children };
}

export type { ErrnoCode };

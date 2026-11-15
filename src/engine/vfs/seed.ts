import { Vfs } from './vfs';

interface NodeMeta {
  mode?: number | string;
  owner?: string;
  group?: string;
}

export interface WorldSpec {
  /** The player's account. */
  user: { name: string; groups: string[]; home: string };
  /** Directories to create (parents implied). A string, or an object with metadata. */
  dirs?: (string | ({ path: string } & NodeMeta))[];
  /** Files by absolute path: plain content, or content plus metadata. */
  files?: Record<string, string | ({ content: string } & NodeMeta)>;
  /** Starting directory; defaults to the user's home. */
  cwd?: string;
}

const parseMode = (m: number | string) => (typeof m === 'number' ? m : parseInt(m, 8));

/**
 * Build a world from a plain-data spec. Everything is created as root, owned by
 * root unless stated, except the home directory, which belongs to the player.
 * Then the terminal is handed to the player.
 */
export function buildWorld(spec: WorldSpec, opts: { now?: () => number } = {}): Vfs {
  const vfs = new Vfs({ now: opts.now, home: spec.user.home });

  vfs.mkdir(spec.user.home, { parents: true });
  vfs.chown(spec.user.home, spec.user.name, spec.user.groups[0] ?? spec.user.name);
  applyPatch(vfs, spec, spec.user);

  vfs.credentials = { user: spec.user.name, groups: [...spec.user.groups] };
  vfs.chdir(spec.cwd ?? spec.user.home);
  return vfs;
}

/**
 * Add dirs and files to an existing world, as root, then restore the
 * player's credentials. Entries under the player's home belong to the player
 * unless stated. Existing files are overwritten.
 */
export function applyPatch(
  vfs: Vfs,
  patch: Pick<WorldSpec, 'dirs' | 'files'>,
  user: WorldSpec['user'],
): void {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    const meta = (path: string, m: NodeMeta) => {
      if (m.owner !== undefined || m.group !== undefined) vfs.chown(path, m.owner, m.group);
      if (m.mode !== undefined) vfs.chmod(path, parseMode(m.mode));
    };
    const inHome = (path: string) => path.startsWith(user.home + '/');
    const deferredDirMeta: [string, NodeMeta][] = [];
    for (const d of patch.dirs ?? []) {
      const entry = typeof d === 'string' ? { path: d } : d;
      vfs.mkdir(entry.path, { parents: true });
      deferredDirMeta.push([
        entry.path,
        {
          ...entry,
          owner: entry.owner ?? (inHome(entry.path) ? user.name : undefined),
          group: entry.group ?? (inHome(entry.path) ? user.groups[0] : undefined),
        },
      ]);
    }
    for (const [path, f] of Object.entries(patch.files ?? {})) {
      const entry = typeof f === 'string' ? { content: f } : f;
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      vfs.mkdir(parent, { parents: true });
      vfs.writeFile(path, entry.content);
      meta(path, {
        owner: entry.owner ?? (inHome(path) ? user.name : undefined),
        group: entry.group ?? (inHome(path) ? user.groups[0] : undefined),
        mode: entry.mode,
      });
    }
    // Directory modes last, so locking a directory doesn't block filling it.
    for (const [path, m] of deferredDirMeta) meta(path, m);
  } finally {
    vfs.credentials = saved;
  }
}

import { basename, isVfsError, VfsError } from '../vfs';
import type { IO, ShellContext } from './types';
import { defineCommand, reason } from './util';

/** GNU-style quoting of a file name in messages: 'name'. */
const q = (s: string) => `'${s}'`;

/** Join a directory and a name, keeping the user's spelling of the directory. */
function into(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

/** Ask a yes/no question on the terminal (for -i). Without a terminal, the answer is no. */
async function confirm(io: IO, question: string): Promise<boolean> {
  io.stderr.write(question);
  if (!io.tty) {
    io.stderr.write('\n');
    return false;
  }
  let answer = '';
  for (;;) {
    const k = await io.tty.readKey();
    if (k === '\r' || k === '\n') break;
    if (k === '\x03') {
      answer = '';
      break;
    }
    if (k.length === 1 && k >= ' ') {
      answer += k;
      io.stderr.write(k);
    }
  }
  io.stderr.write('\n');
  return /^y/i.test(answer);
}

export const mkdir = defineCommand({
  name: 'mkdir',
  unlockedInAct: 3,
  options: {
    flags: 'pv',
    withValue: 'm',
    long: { parents: { key: 'p' }, verbose: { key: 'v' }, mode: { key: 'm', takesValue: true } },
  },
  run(opts, io, ctx) {
    if (opts.operands.length === 0) {
      io.stderr.write("mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
      return 1;
    }
    const modeRaw = opts.values.get('m');
    const mode = modeRaw === undefined ? undefined : parseInt(modeRaw, 8);
    if (modeRaw !== undefined && (!/^[0-7]{1,4}$/.test(modeRaw) || Number.isNaN(mode))) {
      io.stderr.write(`mkdir: invalid mode ${q(modeRaw)}\n`);
      return 1;
    }
    let status = 0;
    for (const dir of opts.operands) {
      try {
        // Each directory this call will create, outermost first (for -v).
        const created: string[] = [];
        if (opts.has('p')) {
          const parts = dir.split('/');
          for (let i = 1; i <= parts.length; i++) {
            const p = parts.slice(0, i).join('/');
            if (p && !/^\/+$/.test(p) && !created.includes(p) && !ctx.vfs.exists(p))
              created.push(p);
          }
        } else if (!ctx.vfs.exists(dir)) created.push(dir);
        ctx.vfs.mkdir(dir, { parents: opts.has('p') });
        if (mode !== undefined) ctx.vfs.chmod(dir, mode);
        if (opts.has('v'))
          for (const c of created)
            io.stdout.write(`mkdir: created directory ${q(c.replace(/\/+$/, ''))}\n`);
      } catch (e) {
        io.stderr.write(`mkdir: cannot create directory ${q(dir)}: ${reason(e)}\n`);
        status = 1;
      }
    }
    return status;
  },
});

export const touch = defineCommand({
  name: 'touch',
  unlockedInAct: 3,
  options: { flags: 'acm', long: { 'no-create': { key: 'c' } } },
  run(opts, io, ctx) {
    if (opts.operands.length === 0) {
      io.stderr.write("touch: missing file operand\nTry 'touch --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const f of opts.operands) {
      if (opts.has('c') && !ctx.vfs.exists(f)) continue;
      try {
        ctx.vfs.touch(f);
      } catch (e) {
        io.stderr.write(`touch: cannot touch ${q(f)}: ${reason(e)}\n`);
        status = 1;
      }
    }
    return status;
  },
});

export const rmdir = defineCommand({
  name: 'rmdir',
  unlockedInAct: 3,
  options: { flags: 'pv', long: { parents: { key: 'p' }, verbose: { key: 'v' } } },
  run(opts, io, ctx) {
    if (opts.operands.length === 0) {
      io.stderr.write("rmdir: missing operand\nTry 'rmdir --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const dir of opts.operands) {
      // With -p, also remove each parent named in the path, like `rmdir -p a/b/c`.
      const chain = [dir];
      if (opts.has('p')) {
        const parts = dir.replace(/\/+$/, '').split('/');
        for (let i = parts.length - 1; i > 0; i--) {
          const p = parts.slice(0, i).join('/');
          if (p) chain.push(p);
        }
      }
      for (const d of chain) {
        try {
          ctx.vfs.rmdir(d);
          if (opts.has('v')) io.stdout.write(`rmdir: removing directory, ${q(d)}\n`);
        } catch (e) {
          io.stderr.write(`rmdir: failed to remove ${q(d)}: ${reason(e)}\n`);
          status = 1;
          break;
        }
      }
    }
    return status;
  },
});

export const rm = defineCommand({
  name: 'rm',
  unlockedInAct: 3,
  options: {
    flags: 'rRfivd',
    long: {
      recursive: { key: 'r' },
      force: { key: 'f' },
      interactive: { key: 'i' },
      verbose: { key: 'v' },
      dir: { key: 'd' },
      'no-preserve-root': { key: 'no-preserve-root' },
    },
  },
  async run(opts, io, ctx) {
    const recursive = opts.has('r') || opts.has('R');
    const force = opts.has('f') && opts.flags.lastIndexOf('f') > opts.flags.lastIndexOf('i');
    const interactive = opts.has('i') && !force;
    if (opts.operands.length === 0) {
      if (force) return 0;
      io.stderr.write("rm: missing operand\nTry 'rm --help' for more information.\n");
      return 1;
    }
    let status = 0;
    for (const path of opts.operands) {
      const base = basename(path);
      if ((base === '.' || base === '..') && recursive) {
        io.stderr.write(`rm: refusing to remove '.' or '..' directory: skipping ${q(path)}\n`);
        status = 1;
        continue;
      }
      if (ctx.vfs.resolve(path) === '/' && recursive) {
        io.stderr.write(
          "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n",
        );
        status = 1;
        continue;
      }
      let isDir: boolean;
      try {
        isDir = ctx.vfs.stat(path).type === 'dir';
      } catch (e) {
        if (force && isVfsError(e, 'ENOENT')) continue;
        io.stderr.write(`rm: cannot remove ${q(path)}: ${reason(e)}\n`);
        status = 1;
        continue;
      }
      if (isDir && !recursive && !opts.has('d')) {
        io.stderr.write(`rm: cannot remove ${q(path)}: Is a directory\n`);
        status = 1;
        continue;
      }
      if (interactive) {
        const what = isDir
          ? 'directory'
          : ctx.vfs.stat(path).size === 0
            ? 'regular empty file'
            : 'regular file';
        if (!(await confirm(io, `rm: remove ${what} ${q(path)}? `))) continue;
      }
      try {
        // For -v, everything inside goes first (deepest first), as rm reports it.
        const inside: { path: string; dir: boolean }[] = [];
        if (opts.has('v') && isDir && recursive) {
          const root = ctx.vfs.resolve(path);
          const walk = [...ctx.vfs.walk(path)].slice(1);
          for (const st of walk.reverse()) {
            inside.push({
              path: into(path.replace(/\/+$/, ''), st.path.slice(root.length + 1)),
              dir: st.type === 'dir',
            });
          }
          // Files before their parent directory, each directory after its contents.
          inside.sort((a, b) =>
            b.path.startsWith(a.path + '/')
              ? 1
              : a.path.startsWith(b.path + '/')
                ? -1
                : a.path < b.path
                  ? -1
                  : 1,
          );
        }
        if (isDir && !recursive) ctx.vfs.rmdir(path);
        else ctx.vfs.remove(path, { recursive });
        if (opts.has('v')) {
          for (const x of inside)
            io.stdout.write(`removed ${x.dir ? 'directory ' : ''}${q(x.path)}\n`);
          io.stdout.write(`removed ${isDir ? 'directory ' : ''}${q(path)}\n`);
        }
      } catch (e) {
        if (!(e instanceof VfsError)) throw e;
        // A recursive removal blocked deeper down names the blocking path, like rm does.
        const shown = e.path === path || e.path === ctx.vfs.resolve(path) ? path : e.path;
        io.stderr.write(`rm: cannot remove ${q(shown)}: ${e.reason}\n`);
        status = 1;
      }
    }
    return status;
  },
});

/** Shared by cp and mv: where each source lands, honoring "copy into this directory". */
function plan(
  verb: 'cp' | 'mv',
  operands: string[],
  io: IO,
  ctx: ShellContext,
  targetDirFlag?: string,
): { src: string; dst: string }[] | null {
  if (operands.length === 0 || (operands.length === 1 && targetDirFlag === undefined)) {
    io.stderr.write(
      operands.length === 0
        ? `${verb}: missing file operand\nTry '${verb} --help' for more information.\n`
        : `${verb}: missing destination file operand after ${q(operands[0])}\nTry '${verb} --help' for more information.\n`,
    );
    return null;
  }
  const target = targetDirFlag ?? operands[operands.length - 1];
  const sources = targetDirFlag !== undefined ? operands : operands.slice(0, -1);
  const targetIsDir = ctx.vfs.isDir(target);
  if (sources.length > 1 && !targetIsDir) {
    io.stderr.write(`${verb}: target ${q(target)}: Not a directory\n`);
    return null;
  }
  return sources.map((src) => ({ src, dst: targetIsDir ? into(target, basename(src)) : target }));
}

export const cp = defineCommand({
  name: 'cp',
  unlockedInAct: 3,
  options: {
    flags: 'rRvni',
    withValue: 't',
    long: {
      recursive: { key: 'r' },
      verbose: { key: 'v' },
      'no-clobber': { key: 'n' },
      'target-directory': { key: 't', takesValue: true },
    },
  },
  async run(opts, io, ctx) {
    const moves = plan('cp', opts.operands, io, ctx, opts.values.get('t'));
    if (!moves) return 1;
    const recursive = opts.has('r') || opts.has('R');
    if (opts.has('n')) {
      // coreutils 9.4 warns about -n's changing meaning; we match it.
      io.stderr.write(
        'cp: warning: behavior of -n is non-portable and may change in future; use --update=none instead\n',
      );
    }
    let status = 0;
    for (const { src, dst } of moves) {
      let srcIsDir: boolean;
      try {
        srcIsDir = ctx.vfs.stat(src).type === 'dir';
      } catch (e) {
        io.stderr.write(`cp: cannot stat ${q(src)}: ${reason(e)}\n`);
        status = 1;
        continue;
      }
      if (srcIsDir && !recursive) {
        io.stderr.write(`cp: -r not specified; omitting directory ${q(src)}\n`);
        status = 1;
        continue;
      }
      if (ctx.vfs.exists(dst) && ctx.vfs.resolve(dst) === ctx.vfs.resolve(src)) {
        io.stderr.write(`cp: ${q(src)} and ${q(dst)} are the same file\n`);
        status = 1;
        continue;
      }
      if (ctx.vfs.exists(dst) && !srcIsDir) {
        if (opts.has('n')) continue;
        if (opts.has('i') && !(await confirm(io, `cp: overwrite ${q(dst)}? `))) continue;
      }
      try {
        ctx.vfs.copy(src, dst, { recursive });
        if (opts.has('v')) io.stdout.write(`${q(src)} -> ${q(dst)}\n`);
      } catch (e) {
        if (isVfsError(e, 'EINVAL')) {
          io.stderr.write(`cp: cannot copy a directory, ${q(src)}, into itself, ${q(dst)}\n`);
        } else if (isVfsError(e, 'ENOTDIR') || isVfsError(e, 'EISDIR')) {
          io.stderr.write(
            srcIsDir
              ? `cp: cannot overwrite non-directory ${q(dst)} with directory ${q(src)}\n`
              : `cp: cannot overwrite directory ${q(dst)} with non-directory ${q(src)}\n`,
          );
        } else {
          io.stderr.write(`cp: cannot create regular file ${q(dst)}: ${reason(e)}\n`);
        }
        status = 1;
      }
    }
    return status;
  },
});

export const mv = defineCommand({
  name: 'mv',
  unlockedInAct: 3,
  options: {
    flags: 'vnif',
    withValue: 't',
    long: {
      verbose: { key: 'v' },
      'no-clobber': { key: 'n' },
      force: { key: 'f' },
      'target-directory': { key: 't', takesValue: true },
    },
  },
  async run(opts, io, ctx) {
    const moves = plan('mv', opts.operands, io, ctx, opts.values.get('t'));
    if (!moves) return 1;
    let status = 0;
    for (const { src, dst } of moves) {
      if (!ctx.vfs.exists(src)) {
        let why = 'No such file or directory';
        try {
          ctx.vfs.stat(src);
        } catch (e) {
          why = reason(e);
        }
        io.stderr.write(`mv: cannot stat ${q(src)}: ${why}\n`);
        status = 1;
        continue;
      }
      if (ctx.vfs.exists(dst) && ctx.vfs.resolve(dst) !== ctx.vfs.resolve(src)) {
        if (opts.has('n')) {
          io.stderr.write(`mv: not replacing ${q(dst)}\n`);
          status = 1;
          continue;
        }
        if (opts.has('i') && !opts.has('f') && !(await confirm(io, `mv: overwrite ${q(dst)}? `)))
          continue;
      }
      try {
        ctx.vfs.move(src, dst);
        if (opts.has('v')) io.stdout.write(`renamed ${q(src)} -> ${q(dst)}\n`);
      } catch (e) {
        if (!(e instanceof VfsError)) throw e;
        if (e.code === 'EINVAL') {
          io.stderr.write(`mv: cannot move ${q(src)} to a subdirectory of itself, ${q(dst)}\n`);
        } else if (e.code === 'EISDIR') {
          io.stderr.write(`mv: cannot overwrite directory ${q(dst)} with non-directory\n`);
        } else if (e.code === 'ENOTDIR') {
          io.stderr.write(
            `mv: cannot overwrite non-directory ${q(dst)} with directory ${q(src)}\n`,
          );
        } else if (e.code === 'ENOTEMPTY') {
          io.stderr.write(`mv: cannot move ${q(src)} to ${q(dst)}: Directory not empty\n`);
        } else if (e.code === 'EBUSY') {
          io.stderr.write(`mv: cannot move ${q(src)} to ${q(dst)}: Device or resource busy\n`);
        } else {
          io.stderr.write(`mv: cannot move ${q(src)} to ${q(dst)}: ${e.reason}\n`);
        }
        status = 1;
      }
    }
    return status;
  },
});

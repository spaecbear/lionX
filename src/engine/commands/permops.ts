import type { Vfs } from '../vfs';
import type { IO, ShellContext } from './types';
import { defineCommand, reason } from './util';

const q = (s: string) => `'${s}'`;

/** Read a system file with root's eyes (the commands themselves are trusted). */
function readAsRoot(vfs: Vfs, path: string): string | null {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    return vfs.isFile(path) ? vfs.readFileQuietly(path) : null;
  } finally {
    vfs.credentials = saved;
  }
}

/** Names in the first field of /etc/passwd or /etc/group. */
function names(vfs: Vfs, file: string): string[] {
  const text = readAsRoot(vfs, file);
  if (text === null) return ['root'];
  return text
    .split('\n')
    .map((l) => l.split(':')[0])
    .filter(Boolean);
}

/** Members of each group from /etc/group, plus each user's primary group. */
export function groupsOf(vfs: Vfs, user: string): string[] {
  const groups: string[] = [];
  const passwd = readAsRoot(vfs, '/etc/passwd') ?? '';
  const primaryGid = passwd
    .split('\n')
    .find((l) => l.startsWith(user + ':'))
    ?.split(':')[3];
  for (const line of (readAsRoot(vfs, '/etc/group') ?? '').split('\n')) {
    const [name, , gid, members = ''] = line.split(':');
    if (!name) continue;
    if (gid === primaryGid || members.split(',').includes(user)) groups.push(name);
  }
  return groups.length ? groups : [user];
}

export const whoami = defineCommand({
  name: 'whoami',
  unlockedInAct: 6,
  options: {},
  run(_o, io, ctx) {
    io.stdout.write(ctx.vfs.credentials.user + '\n');
    return 0;
  },
});

export const id = defineCommand({
  name: 'id',
  unlockedInAct: 6,
  options: { flags: 'unG', long: { user: { key: 'u' }, name: { key: 'n' }, groups: { key: 'G' } } },
  run(o, io, ctx) {
    const user = o.operands[0] ?? ctx.vfs.credentials.user;
    if (!names(ctx.vfs, '/etc/passwd').includes(user) && user !== ctx.vfs.credentials.user) {
      io.stderr.write(`id: ${q(user)}: no such user\n`);
      return 1;
    }
    const passwd = (readAsRoot(ctx.vfs, '/etc/passwd') ?? '')
      .split('\n')
      .find((l) => l.startsWith(user + ':'));
    const uid = passwd?.split(':')[2] ?? '0';
    const groups = o.operands[0] ? groupsOf(ctx.vfs, user) : ctx.vfs.credentials.groups;
    const gidOf = (g: string) =>
      (readAsRoot(ctx.vfs, '/etc/group') ?? '')
        .split('\n')
        .find((l) => l.startsWith(g + ':'))
        ?.split(':')[2] ?? '0';
    if (o.has('u')) {
      io.stdout.write((o.has('n') ? user : uid) + '\n');
      return 0;
    }
    if (o.has('G')) {
      io.stdout.write(groups.map((g) => (o.has('n') ? g : gidOf(g))).join(' ') + '\n');
      return 0;
    }
    const primary = groups[0];
    io.stdout.write(
      `uid=${uid}(${user}) gid=${gidOf(primary)}(${primary}) groups=${groups.map((g) => `${gidOf(g)}(${g})`).join(',')}\n`,
    );
    return 0;
  },
});

// ------------------------------------------------------------------ chmod

/**
 * Apply a chmod mode string to `current`: octal (755) or symbolic
 * (u+x,go-w,a=r). Returns null for an invalid mode. When `who` is omitted,
 * bits in the umask are left alone, like GNU chmod.
 */
export function applyMode(
  current: number,
  spec: string,
  isDir: boolean,
  umask = 0o022,
): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clause);
    if (!m) return null;
    const who = m[1] || '';
    let mask = 0;
    for (const w of who || 'a') {
      if (w === 'u' || w === 'a') mask |= 0o4700;
      if (w === 'g' || w === 'a') mask |= 0o2070;
      if (w === 'o' || w === 'a') mask |= 0o1007;
    }
    for (const action of m[2].match(/[-+=][rwxXst]*/g)!) {
      const op = action[0];
      let bits = 0;
      for (const p of action.slice(1)) {
        if (p === 'r') bits |= 0o444;
        if (p === 'w') bits |= 0o222;
        if (p === 'x') bits |= 0o111;
        if (p === 'X' && (isDir || (current & 0o111) !== 0)) bits |= 0o111;
        if (p === 's') bits |= 0o6000;
        if (p === 't') bits |= 0o1000;
      }
      let affected = bits & mask;
      if (!who) affected &= ~umask; // no who: respect the umask
      if (op === '+') mode |= affected;
      else if (op === '-') mode &= ~affected;
      else mode = (mode & ~(mask & 0o7777)) | affected;
    }
  }
  return mode & 0o7777;
}

function walkAll(ctx: ShellContext, path: string): string[] {
  try {
    return [...ctx.vfs.walk(path)].map((s) => s.path);
  } catch {
    return [path];
  }
}

const chmodInner = defineCommand({
  name: 'chmod',
  unlockedInAct: 6,
  options: {
    flags: 'Rvc',
    long: { recursive: { key: 'R' }, verbose: { key: 'v' }, changes: { key: 'c' } },
  },
  run(o, io, ctx) {
    // Modes like -w look like flags; treat a leading symbolic/octal operand before files as the mode.
    const operands = [...o.operands];
    if (operands.length < 2) {
      io.stderr.write(
        operands.length === 0
          ? "chmod: missing operand\nTry 'chmod --help' for more information.\n"
          : `chmod: missing operand after ${q(operands[0])}\nTry 'chmod --help' for more information.\n`,
      );
      return 1;
    }
    const spec = operands.shift()!;
    if (applyMode(0, spec, false) === null) {
      io.stderr.write(
        `chmod: invalid mode: ${q(spec)}\nTry 'chmod --help' for more information.\n`,
      );
      return 1;
    }
    let status = 0;
    for (const target of operands) {
      const paths = o.has('R') ? walkAll(ctx, target) : [target];
      for (const p of paths) {
        const shown = p === ctx.vfs.resolve(target) || p === target ? target : p;
        try {
          const st = ctx.vfs.stat(p);
          const next = applyMode(st.mode, spec, st.type === 'dir', ctx.vfs.umask)!;
          ctx.vfs.chmod(p, next);
          if (o.has('v') || (o.has('c') && next !== st.mode)) {
            const rwx = (m: number) =>
              [6, 3, 0]
                .map((sh) =>
                  ['r', 'w', 'x'].map((c, i) => ((m >> sh) & (4 >> i) ? c : '-')).join(''),
                )
                .join('');
            const fmt = (m: number) => `${m.toString(8).padStart(4, '0')} (${rwx(m)})`;
            io.stdout.write(
              next === st.mode
                ? `mode of ${q(shown)} retained as ${fmt(next)}\n`
                : `mode of ${q(shown)} changed from ${fmt(st.mode)} to ${fmt(next)}\n`,
            );
          }
        } catch (e) {
          const why = reason(e);
          io.stderr.write(
            why === 'Operation not permitted'
              ? `chmod: changing permissions of ${q(shown)}: ${why}\n`
              : `chmod: cannot access ${q(shown)}: ${why}\n`,
          );
          status = 1;
        }
      }
    }
    return status;
  },
});

/**
 * chmod accepts modes like -w that look like options. Pass known options
 * through and everything else (including such modes) as operands.
 */
export const chmod = {
  ...chmodInner,
  run(args: string[], io: IO, ctx: ShellContext) {
    const known = (a: string) =>
      /^-[Rvc]+$/.test(a) || /^--(recursive|verbose|changes|help)$/.test(a);
    const flags = args.filter(known);
    const rest = args.filter((a) => !known(a));
    return chmodInner.run([...flags, '--', ...rest], io, ctx);
  },
};

// ------------------------------------------------------------------ chown

export const chown = defineCommand({
  name: 'chown',
  unlockedInAct: 6,
  options: {
    flags: 'Rvc',
    long: { recursive: { key: 'R' }, verbose: { key: 'v' }, changes: { key: 'c' } },
  },
  run(o, io, ctx) {
    const operands = [...o.operands];
    if (operands.length < 2) {
      io.stderr.write(
        operands.length === 0
          ? "chown: missing operand\nTry 'chown --help' for more information.\n"
          : `chown: missing operand after ${q(operands[0])}\nTry 'chown --help' for more information.\n`,
      );
      return 1;
    }
    const spec = operands.shift()!;
    const [ownerPart, groupPart] = spec.includes(':') ? spec.split(':') : [spec, undefined];
    const owner = ownerPart || undefined;
    const group = groupPart || undefined;
    if (owner && !names(ctx.vfs, '/etc/passwd').includes(owner)) {
      io.stderr.write(`chown: invalid user: ${q(spec)}\n`);
      return 1;
    }
    if (group && !names(ctx.vfs, '/etc/group').includes(group)) {
      io.stderr.write(`chown: invalid group: ${q(spec)}\n`);
      return 1;
    }
    let status = 0;
    for (const target of operands) {
      const paths = o.has('R') ? walkAll(ctx, target) : [target];
      for (const p of paths) {
        const shown = p === ctx.vfs.resolve(target) || p === target ? target : p;
        try {
          const before = ctx.vfs.stat(p);
          ctx.vfs.chown(p, owner, group);
          if (o.has('v')) {
            const was = `${before.owner}:${before.group}`;
            const now = `${owner ?? before.owner}:${group ?? before.group}`;
            io.stdout.write(
              was === now
                ? `ownership of ${q(shown)} retained as ${now}\n`
                : `changed ownership of ${q(shown)} from ${was} to ${now}\n`,
            );
          }
        } catch (e) {
          const why = reason(e);
          io.stderr.write(
            why === 'Operation not permitted'
              ? `chown: changing ownership of ${q(shown)}: ${why}\n`
              : `chown: cannot access ${q(shown)}: ${why}\n`,
          );
          status = 1;
        }
      }
    }
    return status;
  },
});

// ------------------------------------------------------------------- sudo

/** How long a correct password is remembered (ms of world time), like sudo's timestamp. */
export const SUDO_TIMEOUT_MS = 15 * 60 * 1000;
const lastAuth = new WeakMap<Vfs, { user: string; at: number }>();

/** Users allowed to sudo, from /etc/sudoers lines like "apprentice ALL=(ALL) ALL". */
function sudoers(vfs: Vfs): string[] {
  return (readAsRoot(vfs, '/etc/sudoers') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/)[0]);
}

function passwordOf(vfs: Vfs, user: string): string | null {
  const line = (readAsRoot(vfs, '/etc/shadow') ?? '')
    .split('\n')
    .find((l) => l.startsWith(user + ':'));
  return line ? line.slice(user.length + 1).split(':')[0] : null;
}

/** Read a line from the terminal without echoing it. */
async function readSecret(io: IO): Promise<string | null> {
  if (io.tty!.readSecret) return io.tty!.readSecret();
  let s = '';
  for (;;) {
    const k = await io.tty!.readKey();
    if (k === '\r' || k === '\n') return s;
    if (k === '\x03') return null;
    if (k === '\x7f' || k === '\b') s = s.slice(0, -1);
    else if (k.length === 1 && k >= ' ') s += k;
  }
}

export const sudo = defineCommand({
  name: 'sudo',
  unlockedInAct: 6,
  options: {
    flags: 'Sk',
    withValue: 'u',
    long: { stdin: { key: 'S' }, user: { key: 'u', takesValue: true } },
    stopAtOperand: true,
  },
  async run(o, io, ctx) {
    const me = ctx.vfs.credentials.user;
    const target = o.values.get('u') ?? 'root';
    const [name, ...args] = o.operands;
    if (o.has('k')) lastAuth.delete(ctx.vfs);
    if (!name) {
      if (o.has('k')) return 0;
      io.stderr.write('usage: sudo [-S] [-u user] command [arg ...]\n');
      return 1;
    }
    if (me !== 'root') {
      if (!sudoers(ctx.vfs).includes(me)) {
        io.stderr.write(`${me} is not in the sudoers file.\n`);
        return 1;
      }
      const cached = lastAuth.get(ctx.vfs);
      const fresh = cached && cached.user === me && ctx.vfs.now() - cached.at < SUDO_TIMEOUT_MS;
      let stdin = io.stdin;
      if (!fresh) {
        const want = passwordOf(ctx.vfs, me);
        let ok = false;
        if (o.has('S')) {
          // -S: the password is the first line of standard input.
          const nl = stdin.indexOf('\n');
          const given = nl === -1 ? stdin : stdin.slice(0, nl);
          stdin = nl === -1 ? '' : stdin.slice(nl + 1);
          io.stderr.write(`[sudo] password for ${me}: `);
          ok = want !== null && given === want;
          if (!ok) {
            io.stderr.write('\nSorry, try again.\n');
            io.stderr.write('sudo: no password was provided\nsudo: 1 incorrect password attempt\n');
            return 1;
          }
          io.stderr.write('\n');
        } else if (!io.tty) {
          io.stderr.write(
            'sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper\nsudo: a password is required\n',
          );
          return 1;
        } else {
          for (let tries = 1; tries <= 3 && !ok; tries++) {
            io.stderr.write(`[sudo] password for ${me}: `);
            const given = await readSecret(io);
            io.stderr.write('\n');
            if (given === null) return 1;
            ok = want !== null && given === want;
            if (!ok && tries < 3) io.stderr.write('Sorry, try again.\n');
          }
          if (!ok) {
            io.stderr.write('sudo: 3 incorrect password attempts\n');
            return 1;
          }
        }
        lastAuth.set(ctx.vfs, { user: me, at: ctx.vfs.now() });
      }
      io = { ...io, stdin };
    }
    const cmd = ctx.registry.get(name);
    if (!cmd) {
      io.stderr.write(`sudo: ${name}: command not found\n`);
      return 1;
    }
    const saved = ctx.vfs.credentials;
    ctx.vfs.credentials = {
      user: target,
      groups: target === 'root' ? ['root'] : groupsOf(ctx.vfs, target),
    };
    try {
      return await cmd.run(args, io, ctx);
    } finally {
      ctx.vfs.credentials = saved;
    }
  },
});

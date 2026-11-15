import type { Vfs } from '../vfs';
import { editFile } from './editor';
import type { IO, ShellContext } from './types';
import { defineCommand, reason } from './util';

export const CRON_SPOOL = '/var/spool/cron/crontabs';

/** Do something as root (crontab is a privileged program on real systems too). */
function asRoot<T>(vfs: Vfs, fn: () => T): T {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    return fn();
  } finally {
    vfs.credentials = saved;
  }
}

/** The crontab text for `user`, or null if they have none. */
export function readCrontab(vfs: Vfs, user: string): string | null {
  return asRoot(vfs, () =>
    vfs.isFile(`${CRON_SPOOL}/${user}`) ? vfs.readFileQuietly(`${CRON_SPOOL}/${user}`) : null,
  );
}

const FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;
const NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];

/** Check crontab text the way cron does; returns an error message or null. */
export function validateCrontab(text: string, source: string): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) continue; // VAR=value lines
    if (/^@(reboot|yearly|annually|monthly|weekly|daily|hourly)\s+\S/.test(l)) continue;
    const fields = l.split(/\s+/);
    for (let f = 0; f < 5; f++) {
      if (fields[f] === undefined || !FIELD.test(fields[f])) {
        return `"${source}":${i + 1}: bad ${NAMES[f]}\nerrors in crontab file, can't install.\n`;
      }
    }
    if (fields.length < 6)
      return `"${source}":${i + 1}: bad command\nerrors in crontab file, can't install.\n`;
  }
  return null;
}

function install(vfs: Vfs, user: string, text: string) {
  asRoot(vfs, () => {
    vfs.mkdir(CRON_SPOOL, { parents: true });
    vfs.chmod(CRON_SPOOL, 0o700); // other users may not look in the spool
    vfs.writeFile(`${CRON_SPOOL}/${user}`, text.endsWith('\n') || text === '' ? text : text + '\n');
    vfs.chmod(`${CRON_SPOOL}/${user}`, 0o600);
  });
}

export const crontab = defineCommand({
  name: 'crontab',
  unlockedInAct: 9,
  options: { flags: 'lre', withValue: 'u' },
  async run(o, io: IO, ctx: ShellContext) {
    const me = ctx.vfs.credentials.user;
    const user = o.values.get('u') ?? me;
    if (user !== me && me !== 'root') {
      io.stderr.write('crontab: must be privileged to use -u\n');
      return 1;
    }
    if (o.has('l')) {
      const text = readCrontab(ctx.vfs, user);
      if (text === null) {
        io.stderr.write(`no crontab for ${user}\n`);
        return 1;
      }
      io.stdout.write(text);
      return 0;
    }
    if (o.has('r')) {
      if (readCrontab(ctx.vfs, user) === null) {
        io.stderr.write(`no crontab for ${user}\n`);
        return 1;
      }
      asRoot(ctx.vfs, () => ctx.vfs.unlink(`${CRON_SPOOL}/${user}`));
      return 0;
    }
    if (o.has('e')) {
      if (!io.tty) {
        io.stderr.write('crontab: no terminal to edit with\n');
        return 1;
      }
      const tmp = `/tmp/crontab.${user}`;
      const before = readCrontab(ctx.vfs, user) ?? '# m h  dom mon dow   command\n';
      ctx.vfs.writeFile(tmp, before);
      await editFile(tmp, io, ctx);
      const after = ctx.vfs.readFile(tmp);
      ctx.vfs.unlink(tmp);
      if (after === before && readCrontab(ctx.vfs, user) !== null) {
        io.stderr.write('crontab: no changes made to crontab\n');
        return 0;
      }
      const err = validateCrontab(after, tmp);
      if (err) {
        io.stderr.write(err);
        return 1;
      }
      install(ctx.vfs, user, after);
      io.stderr.write('crontab: installing new crontab\n');
      return 0;
    }
    const file = o.operands[0];
    if (file === undefined) {
      io.stderr.write('usage:\tcrontab [-u user] file\n\tcrontab [-u user] { -e | -l | -r }\n');
      return 1;
    }
    let text: string;
    if (file === '-') text = io.stdin;
    else {
      try {
        text = ctx.vfs.readFile(file);
      } catch (e) {
        io.stderr.write(`${file}: ${reason(e)}\n`);
        return 1;
      }
    }
    const err = validateCrontab(text, file);
    if (err) {
      io.stderr.write(err);
      return 1;
    }
    install(ctx.vfs, user, text);
    return 0;
  },
});

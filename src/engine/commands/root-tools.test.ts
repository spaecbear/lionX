import { createSession } from '../session';
import { loadGameContent } from '../../content/game';
import { createRegistry } from '.';
import { Shell } from '../shell';
import { buildWorld } from '../vfs';
import { CRON_SPOOL, readCrontab, validateCrontab } from './cron';
import { RESPAWN_DELAY_MS } from '../processes';

function setup() {
  const vfs = buildWorld({
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    dirs: [{ path: '/tmp', mode: '777' }],
  });
  let out = '';
  let err = '';
  const keys: string[] = [];
  const shell = new Shell({
    vfs,
    registry: createRegistry(),
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
  });
  const run = async (line: string, tty = false) => {
    out = '';
    err = '';
    shell.tty = tty
      ? { rows: 20, cols: 60, readKey: async () => keys.shift() ?? '\x18' }
      : undefined;
    const status = await shell.run(line);
    return { out, err, status };
  };
  return { vfs, run, keys };
}

describe('nano', () => {
  it('writes a new file: type, Enter, Ctrl+O, Enter, Ctrl+X', async () => {
    const g = setup();
    g.keys.push(...'#!/bin/bash', '\r', ...'echo hi', '\x0f', '\r', '\x18');
    const r = await g.run('nano ~/s.sh', true);
    expect(r.status).toBe(0);
    expect(g.vfs.readFile('~/s.sh')).toBe('#!/bin/bash\necho hi\n');
    expect(r.out.startsWith('\x1b[?1049h')).toBe(true);
    expect(r.out.endsWith('\x1b[?1049l')).toBe(true);
  });

  it('asks to save on exit; y saves, n discards', async () => {
    const g = setup();
    g.vfs.writeFile('~/a', 'one\n');
    g.keys.push('\x1b[F', ...'!', '\x18', 'y', '\r');
    await g.run('nano ~/a', true);
    expect(g.vfs.readFile('~/a')).toBe('one!\n');
    g.keys.push('x', '\x18', 'n');
    await g.run('nano ~/a', true);
    expect(g.vfs.readFile('~/a')).toBe('one!\n');
  });

  it('edits in the middle: arrows, backspace joining lines, cut line', async () => {
    const g = setup();
    g.vfs.writeFile('~/b', 'aa\nbb\ncc\n');
    g.keys.push('\x1b[B', '\x01', '\x7f', '\x1b[B', '\x0b', '\x0f', '\r', '\x18');
    await g.run('nano ~/b', true);
    expect(g.vfs.readFile('~/b')).toBe('aabb\n');
  });

  it('needs a terminal', async () => {
    const g = setup();
    expect((await g.run('nano x')).err).toBe('Too many errors from stdin\n');
  });
});

describe('crontab', () => {
  it('lists, installs from stdin, validates, and removes', async () => {
    const g = setup();
    expect(await g.run('crontab -l')).toMatchObject({
      err: 'no crontab for apprentice\n',
      status: 1,
    });
    expect((await g.run("echo '*/10 * * * * echo bells' | crontab -")).status).toBe(0);
    expect((await g.run('crontab -l')).out).toBe('*/10 * * * * echo bells\n');
    expect(g.vfs.exists(`${CRON_SPOOL}/apprentice`)).toBe(false); // the spool is root's
    expect(readCrontab(g.vfs, 'apprentice')).toBe('*/10 * * * * echo bells\n');
    expect((await g.run("echo 'sixty * * * * x' | crontab -")).err).toBe(
      '"-":1: bad minute\nerrors in crontab file, can\'t install.\n',
    );
    expect((await g.run('crontab -r')).status).toBe(0);
    expect((await g.run('crontab -r')).err).toBe('no crontab for apprentice\n');
  });

  it('-u needs privilege', async () => {
    const g = setup();
    expect((await g.run('crontab -l -u lionx')).err).toBe(
      'crontab: must be privileged to use -u\n',
    );
  });

  it('-e edits through nano', async () => {
    const g = setup();
    g.keys.push('\x1b[F', '\r', ...'@daily echo dawn', '\x0f', '\r', '\x18');
    const r = await g.run('crontab -e', true);
    expect(r.err).toBe('crontab: installing new crontab\n');
    expect(readCrontab(g.vfs, 'apprentice')).toContain('@daily echo dawn');
  });

  it.each([
    ['0 * * * * echo ok', null],
    ['# just a note\nPATH=/bin\n@reboot echo up', null],
    ['0 * * *', 'bad day-of-week'],
    ['0 25,x * * * a', 'bad hour'],
    ['* * * * *', 'bad command'],
  ])('validate %j', (text, problem) => {
    const r = validateCrontab(text, 'f');
    if (problem === null) expect(r).toBeNull();
    else expect(r).toContain(problem);
  });
});

describe('cron keeps lionX coming back', () => {
  it('lionX returns while its crontab names it, and stays gone once the entry is removed', async () => {
    let t = Date.UTC(2026, 10, 15);
    const s = createSession({ content: loadGameContent(), seed: 1, now: () => t });
    await s.ready;
    s.shell.isUnlocked = () => true;
    const table = s.shell.processes!;
    s.runner.vfs.credentials = { user: 'root', groups: ['root'] };
    s.runner.vfs.mkdir(CRON_SPOOL, { parents: true });
    s.runner.vfs.writeFile(`${CRON_SPOOL}/lionx`, '* * * * * wake lionX\n');
    table.spawn({ name: 'lionX', user: 'lionx', immortal: true });
    await s.shell.run('pkill -9 lionX');
    t += RESPAWN_DELAY_MS;
    expect(table.names()).toContain('lionX');
    await s.shell.run('crontab -r -u lionx');
    await s.shell.run('pkill -9 lionX');
    t += RESPAWN_DELAY_MS;
    expect(table.names()).not.toContain('lionX');
  });
});

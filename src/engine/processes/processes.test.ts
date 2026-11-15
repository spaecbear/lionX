import { createRegistry } from '../commands';
import { Shell } from '../shell';
import { buildWorld } from '../vfs';
import { parseSignal, ProcessTable, RESPAWN_DELAY_MS } from './table';
import { migrate, SAVE_VERSION } from '../save';

function world() {
  let t = Date.UTC(2026, 10, 15, 1, 0);
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const vfs = buildWorld(
    { user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' } },
    { now: clock.now },
  );
  const table = new ProcessTable(clock.now);
  /** Names of everything except the shell's own init and bash. */
  const spirits = () => table.names().filter((n) => n !== 'init' && n !== 'bash');
  let out = '';
  let err = '';
  const keys: string[] = [];
  const shell = new Shell({
    vfs,
    registry: createRegistry(),
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    processes: table,
  });
  const run = async (line: string, opts: { tty?: boolean } = {}) => {
    out = '';
    err = '';
    shell.tty = opts.tty
      ? {
          rows: 24,
          cols: 80,
          readKey: async () => keys.shift() ?? 'q',
          pollKey: async () => keys.shift() ?? null,
        }
      : undefined;
    const status = await shell.run(line);
    return { out, err, status };
  };
  return { table, shell, run, clock, keys, spirits };
}

describe('process table', () => {
  it('parses signals by name and number', () => {
    expect(parseSignal('9')).toBe('KILL');
    expect(parseSignal('KILL')).toBe('KILL');
    expect(parseSignal('sigterm')).toBe('TERM');
    expect(parseSignal('STOP')).toBe('STOP');
    expect(parseSignal('99')).toBeNull();
  });

  it('TERM ends ordinary spirits; stubborn ones need KILL', () => {
    const { table, spirits } = world();
    const imp = table.spawn({ name: 'imp', user: 'apprentice' });
    const mule = table.spawn({ name: 'mule', user: 'apprentice', ignoresTerm: true });
    expect(table.signal(imp.pid, 'TERM', 'apprentice')).toBe('ok');
    expect(table.signal(mule.pid, 'TERM', 'apprentice')).toBe('ok');
    expect(spirits()).toEqual(['mule']);
    table.signal(mule.pid, 'KILL', 'apprentice');
    expect(spirits()).toEqual([]);
  });

  it('only owners and root may signal', () => {
    const { table } = world();
    const p = table.spawn({ name: 'warden', user: 'lionx' });
    expect(table.signal(p.pid, 'KILL', 'apprentice')).toBe('EPERM');
    expect(table.signal(999, 'KILL', 'root')).toBe('ESRCH');
    expect(table.signal(p.pid, 'KILL', 'root')).toBe('ok');
  });

  it('a guarding parent respawns children until it is stopped', () => {
    const { table } = world();
    table.spawn({ name: 'lionX', user: 'lionx', respawnsChildren: true });
    const hog = table.spawn({ name: 'gnawer', user: 'lionx', parent: 'lionX' });
    table.signal(hog.pid, 'KILL', 'root');
    const again = table.byName('gnawer');
    expect(again).toHaveLength(1);
    expect(again[0].pid).not.toBe(hog.pid);
    table.signal(table.byName('lionX')[0].pid, 'STOP', 'root');
    table.signal(again[0].pid, 'KILL', 'root');
    expect(table.byName('gnawer')).toHaveLength(0);
  });

  it('immortal processes come back after a while', () => {
    const { table, clock, spirits } = world();
    const p = table.spawn({ name: 'lionX', user: 'lionx', immortal: true });
    table.signal(p.pid, 'KILL', 'root');
    expect(spirits()).toEqual([]);
    clock.advance(RESPAWN_DELAY_MS);
    expect(spirits()).toEqual(['lionX']);
    table.signal(table.byName('lionX')[0].pid, 'KILL', 'root');
    table.cancelRespawn('lionX');
    clock.advance(RESPAWN_DELAY_MS);
    expect(spirits()).toEqual([]);
  });

  it('timed processes finish on the clock, and pause while stopped', () => {
    const { table, clock, spirits } = world();
    const p = table.spawn({ name: 'sleep', user: 'apprentice', durationMs: 10_000 });
    clock.advance(4000);
    table.signal(p.pid, 'STOP', 'apprentice');
    clock.advance(60_000);
    expect(spirits()).toEqual(['sleep']);
    table.signal(p.pid, 'CONT', 'apprentice');
    clock.advance(5999);
    expect(spirits()).toEqual(['sleep']);
    clock.advance(1);
    expect(spirits()).toEqual([]);
  });

  it('snapshots round-trip', () => {
    const { table, clock } = world();
    table.spawn({ name: 'a', user: 'x', pid: 4242 });
    const back = ProcessTable.load(JSON.parse(JSON.stringify(table.snapshot())), clock.now);
    expect(back.get(4242)?.name).toBe('a');
    expect(back.spawn({ name: 'b', user: 'x' }).pid).toBeGreaterThan(4242);
  });
});

describe('job control', () => {
  it('& starts a real background job; jobs, kill %1, and the Done report', async () => {
    const g = world();
    const r = await g.run('sleep 600 &');
    expect(r.err).toMatch(/^\[1\] \d+\n$/);
    expect((await g.run('jobs')).out).toBe('[1]+  Running                 sleep 600 &\n');
    expect(g.table.names()).toContain('sleep');
    expect((await g.run('kill %1')).out).toBe('[1]+  Terminated              sleep 600\n');
    expect(g.table.names()).not.toContain('sleep');
  });

  it('finished jobs are reported as Done', async () => {
    const g = world();
    await g.run('sleep 5 &');
    g.clock.advance(5000);
    expect((await g.run('pwd')).out).toBe(
      '/home/apprentice\n[1]+  Done                    sleep 5\n',
    );
  });

  it('kill -STOP stops a job; bg resumes it', async () => {
    const g = world();
    await g.run('sleep 600 &');
    await g.run('kill -STOP %1');
    expect((await g.run('jobs')).out).toBe('[1]+  Stopped                 sleep 600\n');
    expect((await g.run('bg')).out).toBe('[1]+ sleep 600 &\n');
    expect((await g.run('bg %1')).err).toBe('bash: bg: job 1 already in background\n');
    expect((await g.run('jobs -l')).out).toMatch(/^\[1\]\+ \d+ Running/);
  });

  it('Ctrl+Z stops a foreground sleep into a job; fg brings it back; Ctrl+C ends it', async () => {
    const g = world();
    g.keys.push('\x1a');
    const z = await g.run('sleep 600', { tty: true });
    expect(z.out).toBe('^Z\n[1]+  Stopped                 sleep 600\n');
    expect(z.status).toBe(148);
    g.keys.push('\x03');
    const c = await g.run('fg', { tty: true });
    expect(c.out).toBe('sleep 600\n^C\n');
    expect(c.status).toBe(130);
    expect(g.table.names()).not.toContain('sleep');
  });

  it('job errors read like Bash', async () => {
    const g = world();
    expect((await g.run('fg')).err).toBe('bash: fg: current: no such job\n');
    expect((await g.run('bg %3')).err).toBe('bash: bg: %3: no such job\n');
    expect((await g.run('kill %3')).err).toBe('bash: kill: %3: no such job\n');
    expect((await g.run('kill 99999')).err).toBe('bash: kill: (99999) - No such process\n');
    expect((await g.run('kill abc')).err).toBe(
      'bash: kill: abc: arguments must be process or job IDs\n',
    );
    expect((await g.run('kill -FOO 1')).err).toBe(
      'bash: kill: FOO: invalid signal specification\n',
    );
    expect((await g.run('kill')).err).toMatch(/^kill: usage:/);
    expect((await g.run('kill 1')).err).toBe('bash: kill: (1) - Operation not permitted\n');
  });

  it('sleep validates its operand', async () => {
    const g = world();
    expect((await g.run('sleep')).err).toBe(
      "sleep: missing operand\nTry 'sleep --help' for more information.\n",
    );
    expect((await g.run('sleep x &')).err).toBe(
      "sleep: invalid time interval 'x'\nTry 'sleep --help' for more information.\n",
    );
    expect((await g.run('sleep 1m')).status).toBe(0);
  });
});

describe('ps, top, pgrep, pkill', () => {
  it('ps shows your shell and jobs; ps aux and -ef show everything', async () => {
    const g = world();
    g.table.spawn({ name: 'lamplighter', user: 'archivist', pid: 4300, cpu: 2 });
    await g.run('sleep 600 &');
    const mine = (await g.run('ps')).out.split('\n');
    expect(mine[0]).toBe('    PID TTY          TIME CMD');
    expect(mine.some((l) => / pts\/0 .* bash$/.test(l))).toBe(true);
    expect(mine.some((l) => / sleep$/.test(l))).toBe(true);
    expect(mine.some((l) => /lamplighter/.test(l))).toBe(false);
    const aux = (await g.run('ps aux')).out;
    expect(aux.split('\n')[0]).toBe(
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
    );
    expect(aux).toMatch(/archivi\+ +4300 +2\.0/);
    expect((await g.run('ps -ef')).out.split('\n')[0]).toBe(
      'UID          PID    PPID  C STIME TTY          TIME CMD',
    );
    expect((await g.run('ps -e')).out).toContain('lamplighter');
  });

  it('top lists the busiest first (batch mode without a terminal)', async () => {
    const g = world();
    g.table.spawn({ name: 'gnawer', user: 'lionx', cpu: 87 });
    g.table.spawn({ name: 'page-turner', user: 'archivist', cpu: 1 });
    const lines = (await g.run('top')).out.split('\n');
    expect(lines[0]).toMatch(/^top - /);
    const rows = lines.slice(lines.findIndex((l) => l.includes('COMMAND')) + 1).filter(Boolean);
    expect(rows[0]).toMatch(/gnawer$/);
  });

  it('top redraws on a terminal until q', async () => {
    const g = world();
    g.keys.push(null as unknown as string, 'q');
    const r = await g.run('top', { tty: true });
    expect(r.out.startsWith('\x1b[?1049h')).toBe(true);
    expect(r.out.endsWith('\x1b[?1049l')).toBe(true);
  });

  it('pgrep and pkill find and signal by name', async () => {
    const g = world();
    g.table.spawn({ name: 'candle-imp', user: 'apprentice', pid: 4400 });
    g.table.spawn({ name: 'candle-imp', user: 'apprentice', pid: 4401 });
    g.table.spawn({ name: 'warden', user: 'lionx', pid: 4402 });
    expect((await g.run('pgrep imp')).out).toBe('4400\n4401\n');
    expect((await g.run('pgrep -l -x candle-imp')).out).toBe('4400 candle-imp\n4401 candle-imp\n');
    expect((await g.run('pgrep nothing')).status).toBe(1);
    expect((await g.run('pkill candle')).status).toBe(0);
    expect(g.table.byName('candle-imp')).toHaveLength(0);
    const denied = await g.run('pkill warden');
    expect(denied.err).toBe('pkill: killing pid 4402 failed: Operation not permitted\n');
    expect(denied.status).toBe(1);
  });

  it('without a process table the commands say so in-world', async () => {
    const vfs = buildWorld({ user: { name: 'a', groups: ['a'], home: '/home/a' } });
    let err = '';
    const sh = new Shell({
      vfs,
      registry: createRegistry(),
      terminal: { stdout: { write() {} }, stderr: { write: (s) => (err += s) } },
    });
    expect(await sh.run('ps')).toBe(1);
    expect(err).toContain('no spirits to see yet');
  });
});

describe('save migration 1 -> 2', () => {
  it('adds an empty process table to old saves', () => {
    const old = { version: 1, savedAt: 0, vfs: {}, runner: {}, progress: {}, env: {}, history: [] };
    const up = migrate(old);
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.processes).toBeNull();
    expect(up.jobs).toEqual([]);
  });
});

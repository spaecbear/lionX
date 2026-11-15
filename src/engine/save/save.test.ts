import { loadGameContent } from '../../content/game';
import { createSession, type GameSession } from '../session';
import { Shell } from '../shell';
import {
  browserStorage,
  eraseSlot,
  memoryStorage,
  migrate,
  readSlot,
  SAVE_VERSION,
  SaveError,
  writeSlot,
  type SaveStorage,
} from './save';
import { createTitleRegistry, describeSlot } from './title';

const content = loadGameContent();
const LESSONS = [
  'pwd',
  'ls -a',
  'cat .under-the-floorboard',
  'cd /archive/lantern-hall',
  'cat lantern-log.txt',
  'cd',
];

async function run(s: GameSession, line: string) {
  const status = await s.shell.run(line);
  return s.runner.afterCommand(line, status, '');
}

describe('save and restore (done criterion)', () => {
  it('a reload mid-duty restores the exact world, cwd, and duty', async () => {
    const storage = memoryStorage();
    const a = createSession({ content, seed: 42, now: () => 1000 });
    a.opening();
    for (const l of LESSONS) await run(a, l);
    const duty = a.runner.current!.duty!;
    // Get partway: run the first line of the solution, wander, change a variable.
    await run(a, duty.solution[0]);
    await run(a, 'SPELL=lumen');
    const history = ['pwd', 'ls -a'];
    expect(writeSlot(storage, 1, a.toSave(history))).toBe(true);

    // "Reload": a brand-new session from storage.
    const read = readSlot(storage, 1);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    const b = createSession({ content, save: read.data, now: () => 2000 });
    expect(b.resumed).toBe(true);
    expect(b.history).toEqual(history);
    expect(b.runner.vfs.serialize()).toEqual(a.runner.vfs.serialize());
    expect(b.runner.vfs.cwd).toBe(a.runner.vfs.cwd);
    expect(b.runner.currentPhase).toBe('duties');
    expect(b.runner.current!.duty!.signature).toBe(duty.signature);
    expect(b.runner.progress).toEqual(a.runner.progress);
    expect(b.shell.env.get('SPELL')).toBe('lumen');
    expect(b.runner.known).toEqual(a.runner.known);

    // The rest of the solution still finishes the duty.
    let said: ReturnType<GameSession['runner']['afterCommand']> = [];
    for (const l of duty.solution.slice(1)) said = await run(b, l);
    expect(said.some((n) => n.kind === 'event' && n.event === 'duty-complete')).toBe(true);
  });

  it('a read that happened before saving still counts after loading', async () => {
    const a = createSession({ content, seed: 1 });
    a.opening();
    await run(a, 'pwd');
    await run(a, 'ls');
    // In the "hidden" step, read the page via a command whose effect is recorded...
    a.runner.recordCommand('ls', ['-a'], 0);
    const save = a.toSave([]);
    const b = createSession({ content, save });
    expect(b.runner.snapshot()).toEqual(a.runner.snapshot());
  });

  it('resume() welcomes the player back and repeats the instruction', () => {
    const a = createSession({ content, seed: 1 });
    a.opening();
    const b = createSession({ content, save: a.toSave([]) });
    const said = b.opening().map((n) => (n as { text: string }).text);
    expect(said[0]).toContain('Back again');
    expect(said[1]).toBe('Type `pwd` and press Enter. It names the room you stand in.');
  });

  it('refuses a save for a wing that does not match', () => {
    const save = createSession({ content, seed: 1 }).toSave([]);
    save.runner.wingId = 'nowhere';
    expect(() => createSession({ content, save })).toThrow(/Unknown wing/);
  });
});

describe('migrations', () => {
  const current = () =>
    createSession({ content, seed: 1 }).toSave([]) as unknown as Record<string, unknown>;

  it('passes current saves through', () => {
    expect(migrate(current()).version).toBe(SAVE_VERSION);
  });

  it('runs each step in order from old to new', () => {
    const order: number[] = [];
    const table = {
      1: (d: Record<string, unknown>) => (order.push(1), { ...d, added: 'in 2' }),
      2: (d: Record<string, unknown>) => (order.push(2), { ...d, history: d.history ?? [] }),
    };
    const out = migrate({ ...current(), version: 1 }, table, 3) as unknown as Record<
      string,
      unknown
    >;
    expect(order).toEqual([1, 2]);
    expect(out.version).toBe(3);
    expect(out.added).toBe('in 2');
  });

  it.each<[Record<string, unknown>, RegExp]>([
    [{ version: 99 }, /newer version/],
    [{ version: 'x' }, /no valid version/],
    [{ version: 0 }, /No way to upgrade a version 0 save/],
    [{ version: SAVE_VERSION, vfs: {}, runner: {} }, /missing progress/],
  ])('rejects %j', (raw, msg) => {
    expect(() => migrate(raw)).toThrow(SaveError);
    expect(() => migrate(raw)).toThrow(msg);
  });
});

describe('slot storage', () => {
  const save = () =>
    createSession({ content, seed: 1, now: () => Date.UTC(2026, 10, 15, 1, 20) }).toSave([]);

  it('writes, reads, and erases slots', () => {
    const s = memoryStorage();
    expect(readSlot(s, 2)).toEqual({ status: 'empty' });
    writeSlot(s, 2, save());
    expect(readSlot(s, 2).status).toBe('ok');
    expect(eraseSlot(s, 2)).toBe(true);
    expect(readSlot(s, 2)).toEqual({ status: 'empty' });
  });

  it('reports damaged saves instead of throwing', () => {
    const s = memoryStorage();
    s.setItem('archive-of-echoes:slot:1', '{not json');
    expect(readSlot(s, 1)).toEqual({ status: 'broken', reason: 'the save is damaged' });
    s.setItem('archive-of-echoes:slot:1', JSON.stringify({ version: 99 }));
    expect(readSlot(s, 1)).toMatchObject({
      status: 'broken',
      reason: expect.stringMatching(/newer version/),
    });
  });

  it('never throws when storage is full, blocked, or missing', () => {
    const angry: SaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(writeSlot(angry, 1, save())).toBe(false);
    expect(readSlot(angry, 1)).toEqual({ status: 'broken', reason: 'storage is unavailable' });
    expect(eraseSlot(angry, 1)).toBe(false);
    expect(writeSlot(null, 1, save())).toBe(false);
    expect(readSlot(null, 1)).toEqual({ status: 'empty' });
    expect(eraseSlot(null, 1)).toBe(false);
    expect(browserStorage()).toBeNull(); // no localStorage under Node
  });

  it('rejects slots outside 1-3', () => {
    expect(writeSlot(memoryStorage(), 4, save())).toBe(false);
  });

  it('describes slots in-world', () => {
    const now = Date.UTC(2026, 10, 15, 2, 0);
    expect(describeSlot(1, { status: 'empty' }, now)).toBe('  1  (empty)');
    expect(describeSlot(2, { status: 'ok', data: save() }, now)).toBe(
      '  2  lantern-hall, in lessons, 0 duties done  (saved Nov 15 01:20)',
    );
    expect(describeSlot(3, { status: 'broken', reason: 'x' }, now)).toBe('  3  (unreadable: x)');
  });
});

describe('title screen spells', () => {
  function title(keys: string[] = []) {
    const storage = memoryStorage();
    const played: number[] = [];
    const registry = createTitleRegistry(
      { storage, play: (n) => played.push(n), now: () => 0 },
      'HELP TEXT\n',
    );
    let out = '';
    let err = '';
    const shell = new Shell({
      vfs: createSession({ content, seed: 1 }).runner.vfs,
      registry,
      terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
      tty: { rows: 24, cols: 80, readKey: async () => keys.shift() ?? 'n' },
    });
    const run = async (l: string) => {
      out = '';
      err = '';
      const status = await shell.run(l);
      return { out, err, status };
    };
    return { storage, played, run };
  }

  it('slots lists all three', async () => {
    const t = title();
    expect((await t.run('slots')).out).toBe('  1  (empty)\n  2  (empty)\n  3  (empty)\n');
  });

  it('play starts a slot; bad slots are refused', async () => {
    const t = title();
    expect((await t.run('play 2')).status).toBe(0);
    expect(t.played).toEqual([2]);
    expect(await t.run('play 9')).toMatchObject({
      status: 1,
      err: 'play: choose a slot from 1 to 3, like: play 1\n',
    });
    expect((await t.run('play')).status).toBe(1);
  });

  it('play refuses a damaged slot and suggests erasing it', async () => {
    const t = title();
    t.storage.setItem('archive-of-echoes:slot:1', 'garbage');
    expect((await t.run('play 1')).err).toBe(
      'play: slot 1 cannot be read (the save is damaged). Erase it to start over: erase 1\n',
    );
  });

  it('erase asks first, and only y erases', async () => {
    const t = title(['n', 'y']);
    writeSlot(t.storage, 3, createSession({ content, seed: 1 }).toSave([]));
    expect((await t.run('erase 3')).out).toBe('Erase slot 3 forever? (y/n) n\nKept.\n');
    expect(readSlot(t.storage, 3).status).toBe('ok');
    expect((await t.run('erase 3')).out).toBe('Erase slot 3 forever? (y/n) y\nSlot 3 erased.\n');
    expect(readSlot(t.storage, 3).status).toBe('empty');
    expect((await t.run('erase 3')).out).toBe('Slot 3 is already empty.\n');
  });

  it('help prints the help text', async () => {
    expect((await title().run('help')).out).toBe('HELP TEXT\n');
  });
});

describe('exit', () => {
  it('returns to the title after the command finishes', async () => {
    let exited = 0;
    const s = createSession({ content, seed: 1, onExit: () => exited++ });
    expect(await s.shell.run('exit')).toBe(0);
    await Promise.resolve();
    expect(exited).toBe(1);
  });
});

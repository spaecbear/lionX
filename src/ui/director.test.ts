import { Terminal } from '@xterm/headless';
import { memoryStorage, readSlot } from '../engine/save';
import { loadGameContent } from '../content/game';
import { artFor } from '../content';
import { Director, TITLE_CHIPS } from './director';

const content = loadGameContent();
const LESSONS = [
  'pwd',
  'ls -a',
  'cat .under-the-floorboard',
  'cd /archive/lantern-hall',
  'cat lantern-log.txt',
  'cd',
];

/** A director on a real (headless) terminal, sharing storage across "page loads". */
function boot(storage = memoryStorage()) {
  const term = new Terminal({ cols: 80, rows: 40, allowProposedApi: true });
  const writes: Promise<void>[] = [];
  const chips: string[][] = [];
  const director = new Director(
    {
      get cols() {
        return term.cols;
      },
      get rows() {
        return term.rows;
      },
      write: (s) => void writes.push(new Promise((r) => term.write(s, r))),
    },
    {
      storage,
      content,
      artFor,
      titleHelp: 'HELP\n',
      now: () => Date.UTC(2026, 10, 15, 1, 0),
      onChips: (c) => chips.push(c),
    },
  );
  director.showTitle();
  const flush = () => Promise.all(writes);
  const screen = () => {
    const b = term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < b.length; y++) rows.push(b.getLine(y)!.translateToString(true));
    return rows.join('\n');
  };
  const type = async (line: string) => {
    await director.handleData(line + '\r');
    await director.ready;
    await flush();
  };
  return { director, storage, screen, type, flush, chips };
}

describe('title screen and saves', () => {
  it('boots to a title screen listing three empty slots', async () => {
    const g = boot();
    await g.director.ready;
    await g.flush();
    const s = g.screen();
    expect(s).toContain('A  R  C  H  I  V  E');
    expect(s).toContain('  1  (empty)\n  2  (empty)\n  3  (empty)');
    expect(s.trimEnd().endsWith('lexicon>')).toBe(true);
    expect(g.chips.at(-1)).toEqual(TITLE_CHIPS);
  });

  it('play 1 starts a new game in slot 1 and saves at once', async () => {
    const g = boot();
    await g.type('play 1');
    expect(g.director.slot).toBe(1);
    expect(g.screen()).toContain("Quill: Ah. You're awake.");
    expect(readSlot(g.storage, 1).status).toBe('ok');
    expect(g.chips.at(-1)).toEqual(['pwd', 'ls', 'cat', 'hint', 'status', 'duty']);
  });

  it('a page reload mid-duty puts the player back exactly (done criterion)', async () => {
    const storage = memoryStorage();
    const a = boot(storage);
    await a.type('play 2');
    for (const l of LESSONS) await a.type(l);
    const duty = a.director.session!.runner.current!.duty!;
    await a.type(duty.solution[0]);
    const before = a.director.session!.runner.vfs.serialize();
    const cwd = a.director.session!.runner.vfs.cwd;

    // Reload: a new director on the same storage.
    const b = boot(storage);
    await b.director.ready;
    await b.flush();
    expect(b.screen()).toMatch(/2 {2}lantern-hall, on duty, 0 duties done/);
    await b.type('play 2');
    const s = b.director.session!;
    expect(s.runner.vfs.serialize()).toEqual(before);
    expect(s.runner.vfs.cwd).toBe(cwd);
    expect(s.runner.current!.duty!.signature).toBe(duty.signature);
    expect(b.screen()).toContain('Quill: Back again.');
    expect(b.screen()).toContain(`apprentice@archive:${cwd.replace('/home/apprentice', '~')}$`);
    // History came back too.
    expect(b.director.controller.history.all()).toContain('cat .under-the-floorboard');
    for (const l of duty.solution.slice(1)) await b.type(l);
    expect(s.runner.progress.dutiesDone).toBe(1);
  });

  it('exit saves and returns to the title, which shows the slot', async () => {
    const g = boot();
    await g.type('play 3');
    await g.type('pwd');
    await g.type('exit');
    await g.director.ready;
    await g.flush();
    expect(g.director.slot).toBeNull();
    expect(g.screen()).toMatch(/3 {2}lantern-hall, in lessons, 0 duties done/);
    expect(g.screen()).not.toContain('Quill:');
  });

  it('erase from the title clears a slot after a y', async () => {
    const g = boot();
    await g.type('play 1');
    await g.type('exit');
    await g.director.ready;
    await g.director.handleData('erase 1\r');
    await g.director.handleData('y');
    await g.flush();
    expect(readSlot(g.storage, 1).status).toBe('empty');
    expect(g.screen()).toContain('Slot 1 erased.');
  });

  it('keeps playing without storage, and says saves will not last', async () => {
    const term = new Terminal({ cols: 80, rows: 30, allowProposedApi: true });
    const writes: Promise<void>[] = [];
    const d = new Director(
      { cols: 80, rows: 30, write: (s) => void writes.push(new Promise((r) => term.write(s, r))) },
      { storage: null, content, artFor, titleHelp: '' },
    );
    d.showTitle();
    await d.ready;
    await Promise.all(writes);
    const b = term.buffer.active;
    let text = '';
    for (let y = 0; y < b.length; y++) text += b.getLine(y)!.translateToString(true) + '\n';
    expect(text).toContain('will not keep saves');
    expect(d.save()).toBe(false);
    await d.handleData('play 1\r');
    await d.ready;
    expect(d.session).not.toBeNull();
    expect(d.save()).toBe(false);
  });
});

import { createRegistry } from '../commands';
import { loadCoaching, loadDuties, loadQuillLines, loadWing, type Wing } from '../content';
import { Shell } from '../shell';
import { createHintCommand } from './hint';
import { createDutyCommand, createStatusCommand, wrapIndented } from './spells';
import { LessonRunner, type Narration } from './runner';
import { loadGlossary } from './explain';
import {
  glossarySource,
  coachingSource,
  dutySources,
  quillSource,
  wingSources,
} from '../../content';
import { newProgress } from '../progression';

const dutyFiles = Object.fromEntries(
  Object.entries(dutySources).map(([id, src]) => [id, loadDuties(src, id)]),
);

/** A runner wired to a real shell, like the game does. */
function play(wing: Wing, opts: { seed?: number } = {}) {
  const runner = new LessonRunner(wing, {
    coaching: loadCoaching(coachingSource),
    dutyFiles,
    lines: loadQuillLines(quillSource),
    progress: newProgress(opts.seed ?? 1),
  });
  const registry = createRegistry().register(
    createHintCommand(() => runner),
    createStatusCommand(() => runner),
    createDutyCommand(() => runner),
  );
  let err = '';
  let out = '';
  const shell = new Shell({
    vfs: runner.vfs,
    registry,
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    onCommandRun: (n, a, s) => runner.recordCommand(n, a, s),
    isUnlocked: (c) => c.unlockedInAct === 0 || runner.knows(c.name),
  });
  const log: Narration[] = runner.start();
  const type = async (line: string) => {
    err = '';
    out = '';
    const status = await shell.run(line);
    const said = runner.afterCommand(line, status, err);
    log.push(...said);
    return said.filter((n) => n.kind === 'quill').map((n) => (n as { text: string }).text);
  };
  const lessons = async () => {
    for (const l of [
      'pwd',
      'ls -a',
      'cat .under-the-floorboard',
      'cd /archive/lantern-hall',
      'cat lantern-log.txt',
      'cd',
    ]) {
      await type(l);
    }
  };
  /** Solve the current duty with its own tidy solution. */
  const solveDuty = async () => {
    const d = runner.current!.duty!;
    for (const l of d.solution) await type(l);
    await type('cd'); // wander home between duties
  };
  return { runner, shell, type, log, lessons, solveDuty, output: () => ({ out, err }) };
}

const sample = () => loadWing(wingSources['lantern-hall'], 'lantern-hall.yaml');
const events = (log: Narration[], kind: string) =>
  log.filter((n) => n.kind === 'event' && n.event === kind).map((n) => (n as { id: string }).id);

describe('sample wing: lessons', () => {
  it('teaches spells as lessons begin, and locks the rest', async () => {
    const { runner, type, output } = play(sample());
    expect(runner.known).toEqual(['pwd', 'ls', 'cat']);
    await type('cd /archive');
    expect(output().err).toBe("cd: You don't know that spell yet.\n");
    await type('pwd');
    await type('ls');
    await type('cat .under-the-floorboard');
    expect(runner.known).toEqual(['pwd', 'ls', 'cat', 'cd']);
  });

  it('duty skip sets aside a duty that can no longer be done and gives a fresh one', async () => {
    const { runner, lessons, type } = play(sample());
    await lessons();
    const first = runner.current!.duty!;
    const said = await type('duty skip');
    expect(said[0]).toContain('Set that one aside');
    const next = runner.current!.duty!;
    expect(next.signature).not.toBe(first.signature);
    expect(runner.progress.dutiesDone).toBe(0);
  });

  it('plays the lessons with the exact commands, then moves to duties', async () => {
    const { runner, lessons, log } = play(sample());
    await lessons();
    expect(events(log, 'step-complete')).toEqual([
      'pwd',
      'ls',
      'hidden',
      'to-hall',
      'read-log',
      'home',
    ]);
    expect(events(log, 'lesson-complete')).toEqual(['where-am-i', 'leaving-the-cell']);
    expect(runner.currentPhase).toBe('duties');
    expect(runner.current?.kind).toBe('duty');
  });

  it('accepts other valid ways to reach each goal', async () => {
    const { runner, type } = play(sample());
    await type('pwd -P');
    await type('ls -la ~ | cat'); // ls in a pipeline still counts
    await type('cat ./.under-the-floorboard'); // another path to the same page
    await type('cd ..; cd ../archive/lantern-hall/'); // relative paths, two hops
    expect(runner.current?.step.id).toBe('read-log');
    await type('cat ../lantern-hall/lantern-log.txt'); // a roundabout path still reads it
    await type('cd ~');
    expect(runner.currentPhase).toBe('duties');
  });

  it('does not advance on unrelated commands or failures', async () => {
    const { runner, type } = play(sample());
    await type('echo hello');
    await type('pwdx');
    expect(runner.current?.step.id).toBe('pwd');
  });

  it('coaches common mistakes', async () => {
    const { type } = play(sample());
    expect(await type('dir')).toEqual(['`dir` is a spell from another land. Here we say `ls`.']);
    expect(await type('cat /archive')).toEqual([
      'That is a room, not a book. `ls` looks inside a room; `cd` walks into it.',
    ]);
    expect(await type('cat ghost')).toEqual([
      'Nothing by that name here. `ls` shows what is around you, and Tab can finish names for you.',
    ]);
    expect(await type('cat /archive/sealed-stacks/x')).toEqual([
      'A ward blocks the way. Not every door opens for an apprentice. Yet.',
    ]);
    expect(await type('lionX')).toEqual([
      'The Lexicon does not know that word. Check the spelling, or cast `hint` if you are stuck.',
    ]);
    expect(await type('cd /archive')).toEqual(['That spell is beyond you for now. It will come.']);
    expect(await type('pwd')).not.toContain('That spell is beyond you for now. It will come.');
  });

  it('step coaching wins over shared coaching', async () => {
    const { type } = play(sample());
    await type('pwd');
    await type('ls');
    expect(await type('ls')).toEqual(['Plain `ls` keeps secrets. Try asking for all of them.']);
  });

  it('hints escalate: nudge, spell, full syntax, then repeat the last', async () => {
    const { type, runner } = play(sample());
    const goal = runner.repeat()[0] as { text: string };
    expect(await type('hint')).toEqual([goal.text, 'Ask the Lexicon where you are.']);
    expect(await type('hint')).toEqual([goal.text, 'The spell is `pwd`.']);
    expect(await type('hint')).toEqual([goal.text, 'Type exactly: pwd']);
    expect(await type('hint')).toEqual([goal.text, 'Type exactly: pwd']);
    expect(runner.hintLog.get('pwd')).toBe(4);
  });

  it('solution restates the goal and explains the command piece by piece', async () => {
    const { runner } = play(sample());
    (runner as unknown as { opts: { glossary: unknown } }).opts.glossary =
      loadGlossary(glossarySource);
    const said = runner.solution();
    const b = said.find((n) => n.kind === 'breakdown') as {
      command: string;
      pieces: [string, string][];
    };
    expect(b.command).toBe('pwd');
    expect(b.pieces).toEqual([['pwd', 'names the room you stand in']]);
    expect(runner.current!.hintsUsed).toBe(3);
  });

  it('notices a room with the right name in the wrong place', async () => {
    const wing = sample();
    wing.lessons[0].steps[0].goal = { cwdIs: '/home/apprentice/south-hall/copy-room' };
    wing.lessons[0].spells.push('cd');
    const { type, runner } = play(wing);
    runner.vfs.mkdir('/home/apprentice/north-hall/copy-room', { parents: true });
    runner.vfs.mkdir('/home/apprentice/south-hall/copy-room', { parents: true });
    expect(await type('cd ~/north-hall/copy-room')).toEqual([
      'Right name, wrong place. You are in /home/apprentice/north-hall/copy-room. The one I mean is /home/apprentice/south-hall/copy-room.',
    ]);
  });

  it('fades guidance, and steps back one level after a struggle', async () => {
    const a = play(sample());
    const said = await a.type('pwd');
    expect(said[said.length - 1]).toBe('Now find out what your cell holds.');
    const b = play(sample());
    await b.type('hint');
    const said2 = await b.type('pwd');
    expect(said2[said2.length - 1]).toBe('Type `ls` to list what your cell holds.');
  });
});

describe('sample wing: duties, mastery, and the capstone', () => {
  it('plays from boot through duties and the capstone, and the next wing appears', async () => {
    const g = play(sample());
    await g.lessons();
    let guard = 0;
    while (g.runner.currentPhase === 'duties') {
      await g.solveDuty();
      expect(++guard).toBeLessThan(25);
    }
    expect(g.runner.currentPhase).toBe('capstone');
    expect(events(g.log, 'capstone-open')).toEqual(['lantern-hall']);
    for (const s of g.runner.wingSpells)
      expect(g.runner.progress.mastery[s]).toBeGreaterThanOrEqual(60);

    // The bindery is not there yet.
    await g.type('ls /archive');
    expect(g.output().out).not.toContain('bindery');
    await g.type('cd /archive/lantern-hall/stair/landing/cellar');
    await g.type('ls -a');
    await g.type('cat .keepers-last-note');
    expect(g.runner.done).toBe(true);
    expect(events(g.log, 'wing-complete')).toEqual(['lantern-hall']);
    await g.type('ls /archive');
    expect(g.output().out).toContain('bindery');
    expect(g.runner.progress.wingsDone).toEqual(['lantern-hall']);
  });

  it('swift, hint-free players reach the gate in fewer duties than strugglers', async () => {
    const swift = play(sample());
    await swift.lessons();
    let swiftDuties = 0;
    while (swift.runner.currentPhase === 'duties') {
      await swift.solveDuty();
      swiftDuties++;
    }
    const slow = play(sample());
    await slow.lessons();
    let slowDuties = 0;
    while (slow.runner.currentPhase === 'duties' && slowDuties < 40) {
      await slow.type('hint');
      await slow.type('ls'); // a wasted cast before solving
      await slow.solveDuty();
      slowDuties++;
    }
    expect(swiftDuties).toBeLessThan(slowDuties);
    expect(swift.runner.progress.difficulty).toBeGreaterThan(1);
    expect(slow.runner.progress.difficulty).toBe(1);
  });

  it('swift casting earns a note from Quill', async () => {
    const g = play(sample());
    await g.lessons();
    const d = g.runner.current!.duty!;
    let said: string[] = [];
    for (const l of d.solution) said = await g.type(l);
    expect(said.some((t) => t.startsWith('Swift casting.'))).toBe(true);
  });

  it('rewards: a lore file after the first duty, a decoration after three, a theme after five', async () => {
    const g = play(sample());
    const wing = g.runner.wing;
    wing.gate = 100; // keep duties coming
    await g.lessons();
    for (let i = 0; i < 5; i++) await g.solveDuty();
    expect(events(g.log, 'reward')).toEqual(['first-lantern', 'candle', 'green-phosphor']);
    await g.type('cat ~/lore/the-first-lantern.txt');
    expect(g.output().out).toContain('The first lantern of the Archive');
    expect(g.runner.vfs.isFile('/home/apprentice/candle.txt')).toBe(true);
    expect(g.runner.progress.themes).toEqual(['green-phosphor']);
    expect(g.runner.progress.lore).toEqual(['first-lantern']);
  });

  it('duty files are cleaned up after a duty, unless the player stands inside', async () => {
    const g = play(sample());
    await g.lessons();
    const d = g.runner.current!.duty!;
    for (const l of d.solution) await g.type(l);
    for (const p of d.cleanup) {
      const abs = g.runner.vfs.resolve(p);
      const inside = g.runner.vfs.cwd === abs || g.runner.vfs.cwd.startsWith(abs + '/');
      expect(g.runner.vfs.exists(p)).toBe(inside);
    }
  });

  it('status describes mastery as flavor text, never numbers', async () => {
    const g = play(sample());
    await g.type('pwd');
    await g.type('status');
    const out = g.output().out;
    expect(out).toContain('Your grasp of pwd flickers.');
    expect(out).toContain('You have not truly cast cat yet.');
    expect(out).toContain('Duties done: 0');
    expect(out).toContain('The way forward is still sealed.');
    expect(out).not.toMatch(/\d+%|\b(15|60)\b/);
  });

  it('duty repeats the current task, and offers new work in free play', async () => {
    const g = play(sample());
    expect(await g.type('duty')).toEqual([
      'Type `pwd` and press Enter. It names the room you stand in.',
    ]);
    await g.lessons();
    while (g.runner.currentPhase === 'duties') await g.solveDuty();
    for (const l of ['cat /archive/lantern-hall/stair/landing/cellar/.keepers-last-note'])
      await g.type(l);
    expect(g.runner.done).toBe(true);
    expect(g.runner.current).toBeNull();
    const said = await g.type('duty');
    expect(said.length).toBe(1);
    expect(g.runner.current?.kind).toBe('duty');
    const d = g.runner.current!.duty!;
    for (const l of d.solution) await g.type(l);
    expect(g.runner.current).toBeNull();
    expect(g.runner.done).toBe(true);
  });

  it('hint in free play with nothing to do is quiet advice', async () => {
    const wing = sample();
    delete wing.capstone;
    const g = play(wing);
    await g.lessons();
    expect(g.runner.done).toBe(true);
    expect(await g.type('hint')).toEqual([
      'Nothing needs mending here right now. Wander as you like, or cast `duty` for work.',
    ]);
    expect(await g.type('ls')).toEqual([]);
  });

  it('progress is plain JSON and the duty sequence is reproducible from it', async () => {
    const a = play(sample(), { seed: 77 });
    const b = play(sample(), { seed: 77 });
    await a.lessons();
    await b.lessons();
    expect(a.runner.current!.duty!.signature).toBe(b.runner.current!.duty!.signature);
    expect(JSON.parse(JSON.stringify(a.runner.progress))).toEqual(a.runner.progress);
  });
});

describe('wrapIndented', () => {
  it.each<[string, number, string]>([
    ['  short', 40, '  short'],
    [
      '  The way forward is still sealed. Keep practicing.',
      41,
      '  The way forward is still sealed. Keep\n  practicing.',
    ],
    ['  unbreakable-very-long-word', 10, '  unbreakable-very-long-word'],
  ])('%j at %i', (line, w, want) => expect(wrapIndented(line, w)).toBe(want));
});

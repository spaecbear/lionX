import { createRegistry } from '../commands';
import { loadCoaching, loadWing, type Wing } from '../content';
import { Shell } from '../shell';
import { createHintCommand } from './hint';
import { LessonRunner, type Narration } from './runner';
import { coachingSource, wingSources } from '../../content';

/** A runner wired to a real shell, like the game does. */
function play(wing: Wing) {
  const coaching = loadCoaching(coachingSource);
  const runner = new LessonRunner(wing, { coaching });
  const registry = createRegistry().register(createHintCommand(() => runner));
  let err = '';
  const shell = new Shell({
    vfs: runner.vfs,
    registry,
    terminal: { stdout: { write() {} }, stderr: { write: (s) => (err += s) } },
    onCommandRun: (n, a, s) => runner.recordCommand(n, a, s),
  });
  const log: Narration[] = runner.start();
  const type = async (line: string) => {
    err = '';
    const status = await shell.run(line);
    const said = runner.afterCommand(line, status, err);
    log.push(...said);
    return said.filter((n) => n.kind === 'quill').map((n) => (n as { text: string }).text);
  };
  return { runner, shell, type, log };
}

const sample = () => loadWing(wingSources['lantern-hall'], 'lantern-hall.yaml');

describe('sample wing: lantern hall', () => {
  it('plays start to finish with the exact commands', async () => {
    const { runner, type, log } = play(sample());
    expect(log[0]).toEqual({ kind: 'art', name: 'lantern' });
    expect(runner.current?.step.id).toBe('pwd');
    for (const line of [
      'pwd',
      'ls',
      'ls -a',
      'cat .under-the-floorboard',
      'cd /archive/lantern-hall',
      'cat lantern-log.txt',
      'cd',
    ]) {
      await type(line);
    }
    expect(runner.done).toBe(true);
    const events = log.filter((n) => n.kind === 'event').map((n) => (n as { id: string }).id);
    expect(events).toEqual([
      'pwd',
      'ls',
      'hidden',
      'where-am-i',
      'to-hall',
      'read-log',
      'home',
      'leaving-the-cell',
      'lantern-hall',
    ]);
  });

  it('accepts other valid ways to reach each goal', async () => {
    const { runner, type } = play(sample());
    await type('pwd -P');
    await type('ls -la | head -n 3'); // ls in a pipeline still counts
    await type('head -n 1 ~/.under-the-floorboard'); // any command that reads it
    await type('cd ..; cd ../archive/lantern-hall/'); // relative paths, two hops
    expect(runner.current?.step.id).toBe('read-log');
    await type('less lantern-log.txt'); // no terminal: less just prints, still a read
    await type('cd ~');
    expect(runner.done).toBe(true);
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
    expect(await type('cd..')).toEqual(['Close. Spells need a space before their target: `cd ..`']);
    expect(await type('cat /archive')).toEqual([
      'That is a room, not a book. `ls` looks inside a room; `cd` walks into it.',
    ]);
    expect(await type('cd ghost')).toEqual([
      'Nothing by that name here. `ls` shows what is around you, and Tab can finish names for you.',
    ]);
    expect(await type('cd /archive/sealed-stacks')).toEqual([
      'A ward blocks the way. Not every door opens for an apprentice. Yet.',
    ]);
    expect(await type('lionX')).toEqual([
      'The Lexicon does not know that word. Check the spelling, or cast `hint` if you are stuck.',
    ]);
    expect(await type('echo fine')).toEqual([]);
  });

  it('step coaching wins over shared coaching', async () => {
    const { type } = play(sample());
    await type('pwd');
    await type('ls');
    expect(await type('ls')).toEqual(['Plain `ls` keeps secrets. Try asking for all of them.']);
  });

  it('hints escalate: nudge, spell, full syntax, then repeat the last', async () => {
    const { type, runner } = play(sample());
    expect(await type('hint')).toEqual(['Ask the Lexicon where you are.']);
    expect(await type('hint')).toEqual(['The spell is `pwd`.']);
    expect(await type('hint')).toEqual(['Type exactly: pwd']);
    expect(await type('hint')).toEqual(['Type exactly: pwd']);
    expect(runner.hintLog.get('pwd')).toBe(4);
    expect(runner.current?.step.id).toBe('pwd');
  });

  it('fades guidance, and steps back one level after a struggle', async () => {
    // Without hints: step 2 uses its "goal" guidance.
    const a = play(sample());
    const said = await a.type('pwd');
    expect(said[said.length - 1]).toBe('Now find out what your cell holds.');
    expect(a.runner.current?.level).toBe('goal');

    // With a hint on step 1: step 2 drops back to the exact command.
    const b = play(sample());
    await b.type('hint');
    const said2 = await b.type('pwd');
    expect(said2[said2.length - 1]).toBe('Type `ls` to list what your cell holds.');
    expect(b.runner.current?.level).toBe('exact');
  });

  it('lesson setup patches the world, and repeat() restates the instruction', () => {
    const wing = sample();
    wing.lessons[1].setup = { files: { '/archive/lantern-hall/new-note': 'fresh' } };
    const { runner } = play(wing);
    expect(runner.vfs.exists('/archive/lantern-hall/new-note')).toBe(false);
    expect(runner.repeat()).toEqual([
      { kind: 'quill', text: 'Type `pwd` and press Enter. It names the room you stand in.' },
    ]);
  });

  it('after the wing, hint and afterCommand stay quiet', async () => {
    const { runner, type } = play(sample());
    for (const l of [
      'pwd',
      'ls',
      'cat .under-the-floorboard',
      'cd /archive/lantern-hall',
      'cat lantern-log.txt',
      'cd',
    ])
      await type(l);
    expect(runner.done).toBe(true);
    expect(runner.current).toBeNull();
    expect(runner.repeat()).toEqual([]);
    expect(await type('hint')).toEqual([
      'Nothing needs mending here right now. Wander as you like.',
    ]);
    expect(await type('ls')).toEqual([]);
  });
});

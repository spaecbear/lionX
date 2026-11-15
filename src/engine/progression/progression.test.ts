import { parse as parseLine } from '../shell';
import { createRegistry } from '../commands';
import { loadDuties } from '../content';
import { Shell } from '../shell';
import { evaluate } from '../validator';
import { applyPatch } from '../vfs';
import { ProcessTable } from '../processes';
import { DEFAULT_PATH, installSpells } from '../session';
import { dutySources } from '../../content';
import { generateDuty, instantiate, type Duty, type DutyTemplate } from './duties';
import { applyTask, gateOpen, GAIN, isSwift, masteryPhrase, nextDifficulty } from './mastery';
import { Rng } from './rng';
import { chooseParams, substitute } from './template';

const dutyFiles: Record<string, DutyTemplate[]> = Object.fromEntries(
  Object.entries(dutySources).map(([id, src]) => [id, loadDuties(src, `${id}.yaml`)]),
);
/** The sample wing's templates, for the generator's unit tests. */
const templates: DutyTemplate[] = dutyFiles['lantern-hall'];
import { CONSTRUCT_SPELLS } from '../shell/executor';
const ALL_SPELLS = [...createRegistry().names(), ...CONSTRUCT_SPELLS];

import { playerTty, worldFor as worldForWing } from '../test-support';

/** The world as it stands when a duty file's duties are handed out (files are named for wings). */
const worldFor = (dutyFile: string) => worldForWing(dutyFile);

/** Run a duty's solution in its world and report whether its goal is met. */
async function solve(duty: Duty, dutyFile: string) {
  const vfs = worldFor(dutyFile);
  const processes = new ProcessTable(() => Date.now());
  if (duty.setup) {
    const user = { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' };
    applyPatch(vfs, duty.setup, user, { ownedByPlayer: true });
    for (const p of duty.setup.processes ?? [])
      processes.spawn({ ...p, user: p.user ?? 'apprentice' });
  }
  const reads = new Set<string>();
  vfs.onRead = (p) => reads.add(p);
  const commands: { command: string; args: string[]; status: number }[] = [];
  const shell = new Shell({
    vfs,
    registry: createRegistry(),
    terminal: { stdout: { write() {} }, stderr: { write() {} } },
    onCommandRun: (command, args, status) => commands.push({ command, args, status }),
    tty: playerTty(),
    processes,
    env: { PATH: DEFAULT_PATH },
  });
  installSpells(vfs, shell.registry);
  for (const line of duty.solution) await shell.run(line);
  return {
    met: evaluate(duty.goal, {
      vfs,
      commands,
      reads,
      processes: processes.names(),
      shell: { env: shell.env, exported: shell.exported, aliases: shell.aliases },
    }),
    failures: commands.filter((c) => c.status !== 0),
    usedSpells: [...new Set(commands.map((c) => c.command))],
  };
}

describe('duty generator (done criterion)', () => {
  const cases = Object.keys(dutyFiles).flatMap((file) => [1, 2, 3].map((d) => [file, d] as const));
  it.each(cases)(
    '%s: 20 duties in a row at difficulty %i are unique and solvable with only their spells',
    async (file, difficulty) => {
      const templates = dutyFiles[file];
      const rng = new Rng(1234 + difficulty);
      const recent: string[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const duty = generateDuty(templates, {
          known: ALL_SPELLS,
          focus: [],
          difficulty,
          rng,
          recent,
        })!;
        expect(duty, `duty ${i}`).not.toBeNull();
        expect(seen.has(duty.signature), `duplicate ${duty.signature}`).toBe(false);
        seen.add(duty.signature);
        recent.push(duty.signature);
        const r = await solve(duty, file);
        expect(r.met, `${duty.signature} not solved by its solution`).toBe(true);
        if (!duty.solutionMayFail) {
          expect(r.failures, `${duty.signature} solution had failing commands`).toEqual([]);
        }
        // Commands must be declared; constructs (| > && ...) are never locked, so they may appear freely.
        // Scripts a duty installs (like `kindle`) are not Lexicon spells; only real spells must be declared.
        const spellNames = createRegistry().names();
        for (const s of r.usedSpells.filter(
          (x) => !CONSTRUCT_SPELLS.includes(x) && spellNames.includes(x),
        )) {
          expect(duty.spells, `${duty.signature} uses ${s}`).toContain(s);
        }
      }
    },
  );

  it('never gives the same kind of duty twice in a row', () => {
    const rng = new Rng(5);
    const recent: string[] = [];
    for (let i = 0; i < 60; i++) {
      const d = generateDuty(dutyFiles['apprentice-cells'], {
        known: ALL_SPELLS,
        focus: [],
        difficulty: 1,
        rng,
        recent,
      })!;
      if (recent.length) expect(d.signature.split(':')[0]).not.toBe(recent.at(-1)!.split(':')[0]);
      recent.push(d.signature);
    }
  });

  it('the same seed gives the same duties', () => {
    const run = () => {
      const rng = new Rng(99);
      return Array.from(
        { length: 5 },
        () =>
          generateDuty(templates, { known: ALL_SPELLS, focus: [], difficulty: 1, rng, recent: [] })!
            .signature,
      );
    };
    expect(run()).toEqual(run());
  });

  it('offers only duties whose spells are all known', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 30; i++) {
      const d = generateDuty(templates, {
        known: ['cat'],
        focus: ['cat'],
        difficulty: 1,
        rng,
        recent: [],
      })!;
      expect(d.spells).toEqual(['cat']);
    }
    expect(
      generateDuty(templates, { known: [], focus: [], difficulty: 1, rng, recent: [] }),
    ).toBeNull();
  });

  it('prefers focus spells but still mixes in others', () => {
    const rng = new Rng(7);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const d = generateDuty(templates, {
        known: ALL_SPELLS,
        focus: ['pwd'],
        difficulty: 1,
        rng,
        recent: [],
      })!;
      counts[d.templateId] = (counts[d.templateId] ?? 0) + 1;
    }
    expect(counts['name-the-room']).toBeGreaterThan(150); // the only template using pwd
    expect(Object.keys(counts).length).toBeGreaterThan(1);
  });

  it('avoids paths that already exist in the world', () => {
    const rng = new Rng(3);
    const d = generateDuty(templates, {
      known: ALL_SPELLS,
      focus: [],
      difficulty: 1,
      rng,
      recent: [],
      exists: (p) => p.includes('east-alcove'),
    })!;
    expect(JSON.stringify(d.setup ?? {})).not.toContain('east-alcove');
  });

  it('difficulty deepens the misplaced scroll', () => {
    const t = templates.find((x) => x.id === 'misplaced-scroll')!;
    const depth = (d: number) =>
      instantiate(t, chooseParams(t.params, new Rng(1), d)).solution[0].split('/').length;
    expect(depth(1)).toBeLessThan(depth(2));
    expect(depth(2)).toBeLessThan(depth(3));
  });
});

describe('templates', () => {
  it('substitutes in strings, arrays, and keys, and rejects unknown names', () => {
    expect(substitute({ '/a/{x}': ['{x}!', 3] }, { x: 'y' })).toEqual({ '/a/y': ['y!', 3] });
    expect(() => substitute('{nope}', {})).toThrow(/Unknown template parameter \{nope\}/);
  });

  it('chooses params in order, so text can use earlier ones', () => {
    const p = chooseParams(
      {
        a: { pick: ['x'] },
        n: { int: [4, 4] },
        d: { byDifficulty: ['e', 'm'] },
        t: { text: '{a}-{n}-{d}' },
      },
      new Rng(1),
      3,
    );
    expect(p).toEqual({ difficulty: '3', a: 'x', n: '4', d: 'm', t: 'x-4-m' });
  });
});

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      const x = a.int(1, 6);
      expect(x).toBe(b.int(1, 6));
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
    }
    expect(() => a.pick([])).toThrow();
  });
});

describe('mastery', () => {
  const base = { required: ['ls'], used: ['ls'], hints: 0, commands: 3, par: 3 };

  it('clean use raises mastery; swift adds a bonus', () => {
    expect(applyTask({}, { ...base, par: undefined }).ls).toBe(GAIN.clean);
    expect(applyTask({}, base).ls).toBe(GAIN.clean + GAIN.swift);
    expect(isSwift(base)).toBe(true);
    expect(isSwift({ ...base, commands: 4 })).toBe(false);
  });

  it('hints lower it slightly, never below 0', () => {
    expect(applyTask({ ls: 30 }, { ...base, hints: 1 }).ls).toBe(30 + GAIN.assisted + GAIN.perHint);
    expect(applyTask({ ls: 30 }, { ...base, hints: 3 }).ls).toBe(
      30 + GAIN.assisted + 3 * GAIN.perHint,
    );
    expect(applyTask({}, { ...base, used: [], hints: 3 }).ls).toBe(0);
  });

  it('caps at 100 and gives a little for incidental spells', () => {
    expect(applyTask({ ls: 95 }, base).ls).toBe(100);
    expect(applyTask({}, { ...base, used: ['ls', 'pwd'] }).pwd).toBe(GAIN.incidental);
  });

  it('a required spell that was not used gains nothing without hints', () => {
    expect(applyTask({}, { ...base, used: [] }).ls).toBeUndefined();
  });

  it('difficulty climbs on swift work and eases off with hints', () => {
    expect(nextDifficulty(1, base)).toBe(2);
    expect(nextDifficulty(3, base)).toBe(3);
    expect(nextDifficulty(2, { ...base, hints: 2 })).toBe(1);
    expect(nextDifficulty(1, { ...base, hints: 2 })).toBe(1);
    expect(nextDifficulty(2, { ...base, commands: 9 })).toBe(2);
  });

  it('the gate opens when every spell reaches the threshold', () => {
    expect(gateOpen({ ls: 60, cd: 59 }, ['ls', 'cd'])).toBe(false);
    expect(gateOpen({ ls: 60, cd: 60 }, ['ls', 'cd'])).toBe(true);
    expect(gateOpen({ ls: 30 }, ['ls'], 30)).toBe(true);
  });

  it.each([
    [0, 'You have not truly cast grep yet.'],
    [10, 'Your grasp of grep flickers.'],
    [30, 'Your grasp of grep grows steady.'],
    [60, 'Your grasp of grep holds firm.'],
    [90, 'You cast grep without a second thought.'],
    [100, 'grep answers you like an old friend.'],
  ])('phrase at %i', (n, text) => expect(masteryPhrase('grep', n)).toBe(text));
});

describe('duty template files', () => {
  it('every solution line parses', () => {
    for (const t of Object.values(dutyFiles).flat())
      for (const line of t.solution) expect(() => parseLine(line)).not.toThrow();
    expect(templates.length).toBeGreaterThanOrEqual(4);
  });
});

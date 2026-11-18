import { loadGameContent } from '../content/game';
import type { Narration } from './narrative';
import { createSession, type GameSession } from './session';
import { complete } from './shell';
import { wingChain } from './test-support';

/**
 * Done criterion for the first two wings: a new player can go from boot to
 * the Bindery entrance with no outside help. This player knows nothing but
 * what Quill tells them: they follow each task's last hint ("Type: ...") to
 * the letter, press Tab when told to, and walk where Quill's lines point.
 */

/**
 * Commands in a hint like "Type: cd x   then: ls", "Type: cd an   then press Tab,
 * then Enter", or "Type: sudo ...   then enter your password: oriel".
 */
function commandsFromHint(hint: string): { line: string; tab: boolean; password?: string }[] {
  const m = /Type(?: exactly)?:\s*(.*)$/.exec(hint);
  if (!m) throw new Error(`Hint has no command to type: ${hint}`);
  return m[1].split(/\s+then:\s+/).map((part) => ({
    line: part.split(/\s+then (?:press|enter)\b/)[0].trim(),
    tab: /press Tab/.test(part),
    password: /then enter your password: (\S+)/.exec(part)?.[1],
  }));
}

async function playToBindery(seed: number) {
  const session = createSession({ content: loadGameContent(), seed });
  const said: string[] = [];
  const hear = (ns: Narration[]) => ns.forEach((n) => n.kind === 'quill' && said.push(n.text));
  const out: string[] = [];
  session.shell.terminal = { stdout: { write: (s) => out.push(s) }, stderr: { write: () => {} } };
  // A real terminal: typed passwords when asked, otherwise q (to leave any pager) and Enter.
  const keys: string[] = [];
  session.shell.tty = {
    rows: 24,
    cols: 80,
    readKey: async () => 'q', // leave any pager
    // Passwords only when a hint said which one to type; otherwise nothing (so sudo fails).
    readSecret: async () => keys.shift() ?? null,
  };
  const type = async (line: string) => {
    const status = await session.shell.run(line);
    hear(session.afterCommand(line, status, ''));
    return status;
  };
  hear(session.opening());
  const wingsSeen = [session.runner.wing.id];
  let commands = 0;
  for (let guard = 0; guard < 400; guard++) {
    const cur = session.runner.current;
    if (!cur) {
      // Between wings: Quill says where to walk next.
      const direction = [...said]
        .reverse()
        .map((t) => /`(cd \/archive\/[\w-]+)`/.exec(t)?.[1])
        .find(Boolean);
      if (!direction) break;
      await type(direction);
      commands++;
      if (session.runner.wing.id !== wingsSeen[wingsSeen.length - 1]) {
        wingsSeen.push(session.runner.wing.id);
        continue;
      }
      break; // the direction led somewhere with no new wing: the end of the road so far
    }
    for (const { line, tab, password } of commandsFromHint(cur.step.hints[2])) {
      if (password) keys.push(password);
      let text = line;
      if (tab) {
        const r = complete(text, text.length, {
          vfs: session.runner.vfs,
          commands: session.shell.registry.names(),
        });
        text = text.slice(0, r.start) + r.replacement;
      }
      await type(text);
      commands++;
    }
  }
  return { session, said, out, wingsSeen, commands };
}

describe('boot to the end of every written wing with no outside help (done criterion)', () => {
  const chain = wingChain();
  it.each([1, 2, 3])('seed %i', async (seed) => {
    const { session, said, wingsSeen } = await playToBindery(seed);
    expect(wingsSeen).toEqual(chain.map((w) => w.id));
    expect(session.runner.progress.wingsDone).toEqual(chain.map((w) => w.id));
    const last = chain[chain.length - 1];
    if (last.next) {
      // Standing in the door Quill pointed to, where the next (unwritten) wing begins.
      const door = new RegExp('`cd (/archive/[\\w-]+)`').exec(last.outro!.join(' '))![1];
      expect(session.runner.vfs.cwd).toBe(door);
    } else {
      // The end of the game: free play, lionX tamed.
      expect(session.runner.done).toBe(true);
      expect(session.shell.processes!.byName('lionX')[0]?.user).toBe('archivist');
    }
    // Story beats landed along the way.
    expect(said.join('\n')).toContain('The root is closed for rewriting.');
    expect(said).toContain('lionX.');
  });
});

describe('the opening wings', () => {
  it('teach spells in order and lock the rest', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    expect(s.runner.known).toEqual(['pwd', 'ls']);
    expect(await s.shell.run('cat cell-rules.txt')).toBe(127);
  });
});

describe('reward art', () => {
  it('draws the piece, hangs it in ~/gallery once, and Quill mentions the gallery the first time', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    await s.shell.run('pwd');
    const first = s.afterCommand('pwd', 0, '');
    expect(first).toContainEqual({ kind: 'art', name: 'candle', reward: true });
    const home = s.runner.vfs.home;
    expect(s.runner.vfs.readFile(`${home}/gallery/candle`)).toContain('A small flame.');
    expect(first.some((n) => n.kind === 'quill' && n.text.includes('~/gallery'))).toBe(true);
  });
});

describe('help', () => {
  it('lists the spells you know, with what they do and their flags', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    let out = '';
    s.shell.terminal = { stdout: { write: (t) => (out += t) }, stderr: { write: () => {} } };
    expect(await s.shell.run('help')).toBe(0);
    expect(out).toContain('pwd');
    expect(out).toContain('names the room you stand in');
    expect(out).toContain('man NAME');
    expect(out).not.toContain('grep');
    out = '';
    expect(await s.shell.run('help solution')).toBe(0);
    expect(out).toContain('Usage: solution');
  });
});

describe('secrets', () => {
  it('every secret is hidden somewhere in a full playthrough, and reading it unlocks its cosmetic', async () => {
    const { session } = await playToBindery(1);
    const secrets = loadGameContent().secrets!;
    expect(secrets.length).toBe(14);
    const vfs = session.runner.vfs;
    const missing = secrets.filter((s) => !session.runner.vfs.exists(s.file)).map((s) => s.file);
    expect(missing).toEqual([]);
    const said: string[] = [];
    for (const s of secrets) {
      await session.shell.run(`cat ${s.file}`);
      for (const n of session.afterCommand(`cat ${s.file}`, 0, ''))
        if (n.kind === 'narrator') said.push(n.text);
    }
    const p = session.runner.progress;
    expect(secrets.filter((s) => !p.secrets!.includes(s.id)).map((s) => s.file)).toEqual([]);
    expect(p.songs).toEqual(
      expect.arrayContaining(['rain', 'tavern', 'midnight', 'harbor', 'snowfall', 'sunrise']),
    );
    expect(p.themes).toEqual(
      expect.arrayContaining(['rose', 'ember', 'ink', 'moonlight', 'frost', 'moss']),
    );
    expect(said).toHaveLength(14);
    expect(vfs.readFile('/home/apprentice/gallery/music-box')).toContain('tavern song');
    void vfs;
  });
});

describe('the Grimoire in your cell', () => {
  it('appears once man is learned, with a page for every known spell', async () => {
    const fresh = createSession({ content: loadGameContent(), seed: 1 });
    fresh.opening();
    expect(fresh.runner.vfs.exists('/home/apprentice/grimoire')).toBe(false);
    const { session } = await playToBindery(2);
    const vfs = session.runner.vfs;
    for (const spell of ['ls', 'cat', 'man', 'grep', 'chmod', 'crontab'])
      expect(vfs.readFile(`/home/apprentice/grimoire/${spell}`)).toContain('NAME');
  });
});

describe('achievements', () => {
  it('earns them as you play, each once, and lists them', async () => {
    const { session } = await playToBindery(3);
    const earned = session.runner.progress.achievements ?? [];
    for (const id of [
      'first-words',
      'cells-done',
      'root-done',
      'first-duty',
      'first-pipe',
      'first-sudo',
      'read-the-manual',
      'gallery-10',
    ])
      expect(earned).toContain(id);
    expect(new Set(earned).size).toBe(earned.length);
    // The hidden ones that a normal playthrough reaches.
    expect(earned).toEqual(expect.arrayContaining(['root-done', 'background-spirit']));
    await session.shell.run('clear');
    expect(session.afterCommand('clear', 0, '')).toContainEqual(
      expect.objectContaining({ kind: 'achievement', title: 'Fresh Glass' }),
    );
    let out = '';
    session.shell.terminal = { stdout: { write: (t) => (out += t) }, stderr: { write: () => {} } };
    await session.shell.run('achievements');
    expect(out).toContain('[*] Out of the Cell: Mend the Apprentice Cells.');
    expect(out).toMatch(/Achievements: \d+ of 27/);
  });

  it('announces a new one right after the command that earns it', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    await s.shell.run('pwd');
    expect(s.afterCommand('pwd', 0, '')).toContainEqual({
      kind: 'achievement',
      title: 'First Words',
      says: 'Cast your first spell.',
    });
    await s.shell.run('pwd');
    expect(s.afterCommand('pwd', 0, '').some((n) => n.kind === 'achievement')).toBe(false);
  });
});

describe('the Book of Eco', () => {
  it('every page turns up in a full playthrough and files itself on ~/library in order', async () => {
    const { session } = await playToBindery(1);
    const lib = loadGameContent().library!;
    const vfs = session.runner.vfs;
    expect(lib.pages.filter((p) => !vfs.exists(p.file)).map((p) => p.file)).toEqual([]);
    const said: string[] = [];
    for (const p of lib.pages) {
      await session.shell.run(`cat ${p.file}`);
      for (const n of session.afterCommand(`cat ${p.file}`, 0, ''))
        if (n.kind === 'narrator') said.push(n.text);
    }
    expect(session.runner.progress.library).toHaveLength(lib.pages.length);
    expect(vfs.readdir('/home/apprentice/library')).toEqual(
      lib.pages.map((p, i) => `${String(i + 1).padStart(2, '0')}-${p.id}`),
    );
    expect(said.at(-1)).toBe(lib.complete);
  });

  it('shows gaps as missing pages with a hint', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    const lib = loadGameContent().library!;
    const vfs = s.runner.vfs;
    // Drop page 1 into the cell as the Reading Room would, then read it.
    vfs.writeFile(lib.pages[0].file, lib.pages[0].text);
    await s.shell.run('pwd');
    s.afterCommand('pwd', 0, '');
    vfs.readFile(lib.pages[0].file);
    const said = s.afterCommand('true', 0, '');
    expect(said).toContainEqual({ kind: 'narrator', text: lib.firstFiled });
    expect(vfs.readFile('/home/apprentice/library/02-missing')).toContain(lib.pages[1].where);
  });
});

describe('leftover duty rooms', () => {
  it('do not starve the gate: duties needing a fresh workbench still come up', async () => {
    const { generateDuty } = await import('./progression');
    const { Rng } = await import('./progression/rng');
    const content = loadGameContent();
    const templates = content.dutyFiles.bindery;
    const known = ['pwd', 'ls', 'cd', 'cat', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir'];
    const seen = new Set<string>();
    const rng = new Rng(4);
    // Every possible bench is already there, as if left behind by earlier duties.
    for (let i = 0; i < 80; i++) {
      const d = generateDuty(templates, {
        known,
        focus: ['mkdir', 'touch', 'rmdir'],
        difficulty: 1,
        rng,
        recent: [],
        exists: () => true,
        clear: () => true,
      });
      if (d) seen.add(d.signature.split(':')[0]);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['make-shelf', 'blank-pages', 'empty-shelf']));
  });

  it('the runner clears a stale bench, but never the one the player stands in', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    const vfs = s.runner.vfs;
    vfs.credentials = { user: 'root', groups: ['root'] };
    vfs.mkdir('/archive/bindery/work/bench-a', { parents: true });
    vfs.writeFile('/archive/bindery/work/bench-a/old-scrap', 'x');
    vfs.credentials = { user: 'apprentice', groups: ['apprentice'] };
    const clear = (
      s.runner as unknown as { clearLeftovers: (d: unknown) => boolean }
    ).clearLeftovers.bind(s.runner);
    const duty = {
      cleanup: ['/archive/bindery/work/bench-a'],
      setup: { dirs: ['/archive/bindery/work/bench-a'] },
    };
    vfs.chdir('/archive/bindery/work/bench-a');
    expect(clear(duty)).toBe(false);
    expect(vfs.exists('/archive/bindery/work/bench-a/old-scrap')).toBe(true);
    vfs.chdir('/home/apprentice');
    expect(clear(duty)).toBe(true);
    expect(vfs.exists('/archive/bindery/work/bench-a')).toBe(false);
  });
});

describe('story mode', () => {
  it('plays the whole game from nextStoryCommand alone, with achievements off', async () => {
    const session = createSession({ content: loadGameContent(), seed: 5 });
    const keys: string[] = [];
    session.shell.terminal = { stdout: { write: () => {} }, stderr: { write: () => {} } };
    session.shell.tty = {
      rows: 24,
      cols: 80,
      readKey: async () => 'q',
      readSecret: async () => keys.shift() ?? null,
    };
    session.opening();
    let n = 0;
    for (; n < 2000; n++) {
      const c = session.nextStoryCommand();
      if (!c) break;
      if (c.password) keys.push(c.password);
      let text = c.line;
      if (c.tab) {
        const r = complete(text, text.length, {
          vfs: session.runner.vfs,
          commands: session.shell.registry.names(),
        });
        text = text.slice(0, r.start) + r.replacement;
      }
      const status = await session.shell.run(text);
      session.afterCommand(text, status, '');
    }
    expect(n).toBeLessThan(2000);
    expect(session.runner.progress.wingsDone).toContain('root');
    expect(session.runner.progress.storyMode).toBe(true);
    expect(session.runner.progress.achievements ?? []).toEqual([]);
    // Of the secrets, it found only the guided one (the music box).
    expect(session.runner.progress.secrets).toEqual(['music-box']);
    // It read the Book of Eco along the way.
    expect(session.runner.progress.library).toHaveLength(loadGameContent().library!.pages.length);
  });
});

describe('story mode and secrets', () => {
  it('secrets you read yourself unlock even in story mode; achievements stay off', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    const rain = loadGameContent().secrets!.find((x) => x.id === 'rain-on-the-window')!;
    expect(s.runner.vfs.exists(rain.file)).toBe(true);
    s.setStoryActive(true);
    s.runner.vfs.readFile(rain.file);
    s.afterCommand('true', 0, '');
    expect(s.runner.progress.secrets).toEqual(['rain-on-the-window']);
    // The save used story mode, so achievements stay off.
    expect(s.runner.progress.storyMode).toBe(true);
    expect(s.runner.checkAchievements()).toEqual([]);
  });

  it('leaves the secret note under the desk', () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    expect(s.runner.vfs.readFile('/home/apprentice/.psst-type-story-on')).toContain('story on');
  });
});

describe('duty reset', () => {
  it('puts back trial pages that were overwritten, and leaves pages already shelved alone', async () => {
    const { atCapstone } = await import('./test-support');
    const g = atCapstone('bindery');
    const vfs = g.runner.vfs;
    for (const l of [
      'mkdir -p /archive/bindery/shelf/fiction',
      'mv /archive/bindery/loose-pages/tale-of-the-bell /archive/bindery/shelf/tales',
      'mv /archive/bindery/loose-pages/tale-of-the-moth /archive/bindery/shelf/tales',
      'mkdir -p /archive/bindery/shelf/poetry',
      'mv /archive/bindery/loose-pages/poem-of-ink /archive/bindery/shelf/poetry/',
    ])
      await g.type(l);
    expect(vfs.exists('/archive/bindery/loose-pages/tale-of-the-bell')).toBe(false);
    const said = g.runner.resetTask();
    expect(said.some((n) => n.kind === 'quill' && n.text.includes('tale-of-the-bell'))).toBe(true);
    expect(vfs.exists('/archive/bindery/loose-pages/tale-of-the-bell')).toBe(true);
    expect(vfs.exists('/archive/bindery/loose-pages/tale-of-the-moth')).toBe(true);
    // Already shelved: not put back into loose-pages.
    expect(vfs.exists('/archive/bindery/loose-pages/poem-of-ink')).toBe(false);
    // And the trial can now be finished.
    await g.type('rm /archive/bindery/shelf/tales');
    await g.type('mkdir -p /archive/bindery/shelf/fiction/tales');
    await g.type('mv /archive/bindery/loose-pages/tale-* /archive/bindery/shelf/fiction/tales/');
    await g.type('mv /archive/bindery/loose-pages/poem-* /archive/bindery/shelf/poetry/');
    expect(g.runner.current?.step.id).toBe('quarantine');
  });
});

describe('next', () => {
  it('repeats the objective mid-task, and points to the next wing once one is mended', async () => {
    const s: GameSession = createSession({ content: loadGameContent(), seed: 1 });
    s.opening();
    expect(s.runner.next()).toEqual(s.runner.repeat());
    // A mended wing: next points the way on.
    const { atCapstone } = await import('./test-support');
    const g = atCapstone('bindery');
    const r = g.runner as unknown as { finishWing(): unknown };
    r.finishWing();
    const said = g.runner.next();
    expect(said.some((n) => n.kind === 'quill' && n.text.includes('cd /archive/observatory'))).toBe(
      true,
    );
    // duty also points onward first, then still gives work.
    const duty = g.runner.requestDuty();
    expect(duty[0]).toMatchObject({
      kind: 'quill',
      text: expect.stringContaining('story goes on'),
    });
    expect(duty.some((n) => n.kind === 'quill' && n.text.includes('cd /archive/observatory'))).toBe(
      true,
    );
  });
});

describe('old saves meet changed content', () => {
  it('resumes on a step with no instruction at the saved help level, and past a shortened lesson', async () => {
    const { worldFor } = await import('./test-support');
    const { LessonRunner } = await import('./narrative');
    const content = loadGameContent();
    const wing = content.wings.observatory;
    const counting = wing.lessons.findIndex((l) => l.id === 'counting');
    for (const stepIndex of [1, 99]) {
      const runner = new LessonRunner(wing, {
        ...content,
        restore: {
          vfs: worldFor('observatory').serialize(),
          runner: {
            wingId: 'observatory',
            phase: 'lessons',
            lessonIndex: counting,
            stepIndex,
            hintsUsed: 0,
            struggled: false,
            level: 'goal',
            duty: null,
            commands: [],
            reads: [],
          },
        },
      });
      const said = [...runner.resume(), ...runner.hint(), ...runner.next()];
      for (const n of said)
        if (n.kind === 'quill' || n.kind === 'narrator') expect(typeof n.text).toBe('string');
      expect(said.some((n) => n.kind === 'quill' && n.text.length > 10)).toBe(true);
    }
  });
});

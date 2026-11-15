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
    expect(secrets.length).toBe(12);
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
    expect(said).toHaveLength(12);
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
    let out = '';
    session.shell.terminal = { stdout: { write: (t) => (out += t) }, stderr: { write: () => {} } };
    await session.shell.run('achievements');
    expect(out).toContain('[*] Out of the Cell: Mend the Apprentice Cells.');
    expect(out).toMatch(/Achievements: \d+ of 24/);
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

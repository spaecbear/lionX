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

/** Commands in a hint like "Type: cd x   then: ls" or "Type: cd an   then press Tab, then Enter". */
function commandsFromHint(hint: string): { line: string; tab: boolean }[] {
  const m = /Type(?: exactly)?:\s*(.*)$/.exec(hint);
  if (!m) throw new Error(`Hint has no command to type: ${hint}`);
  return m[1].split(/\s+then:\s+/).map((part) => ({
    line: part.split(/\s+then press\b/)[0].trim(),
    tab: /press Tab/.test(part),
  }));
}

async function playToBindery(seed: number) {
  const session = createSession({ content: loadGameContent(), seed });
  const said: string[] = [];
  const hear = (ns: Narration[]) => ns.forEach((n) => n.kind === 'quill' && said.push(n.text));
  const out: string[] = [];
  session.shell.terminal = { stdout: { write: (s) => out.push(s) }, stderr: { write: () => {} } };
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
    for (const { line, tab } of commandsFromHint(cur.step.hints[2])) {
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
    // Standing in the door Quill pointed to at the end.
    const last = chain[chain.length - 1];
    const door = /`cd (\/archive\/[\w-]+)`/.exec(last.outro!.join(' '))![1];
    expect(session.runner.vfs.cwd).toBe(door);
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

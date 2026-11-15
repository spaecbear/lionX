import { Terminal } from '@xterm/headless';
import { createRegistry } from '../../engine/commands';
import { loadCoaching, loadDuties, loadQuillLines, loadWing } from '../../engine/content';
import { createHintCommand, LessonRunner } from '../../engine/narrative';
import { Shell } from '../../engine/shell';
import { artFor, coachingSource, dutySources, quillSource, wingSources } from '../../content';
import { TerminalController } from './controller';

async function game(opts: { cols?: number; typeDelay?: number } = {}) {
  const cols = opts.cols ?? 80;
  const term = new Terminal({ cols, rows: 30, allowProposedApi: true });
  const runner = new LessonRunner(loadWing(wingSources['lantern-hall']), {
    coaching: loadCoaching(coachingSource),
    dutyFiles: Object.fromEntries(
      Object.entries(dutySources).map(([id, src]) => [id, loadDuties(src, id)]),
    ),
    lines: loadQuillLines(quillSource),
  });
  const shell = new Shell({
    vfs: runner.vfs,
    registry: createRegistry().register(createHintCommand(() => runner)),
    terminal: { stdout: { write() {} }, stderr: { write() {} } },
    onCommandRun: (n, a, s) => runner.recordCommand(n, a, s),
  });
  const writes: Promise<void>[] = [];
  const ctl = new TerminalController(
    {
      get cols() {
        return term.cols;
      },
      get rows() {
        return term.rows;
      },
      write: (s) => void writes.push(new Promise((r) => term.write(s, r))),
    },
    shell,
    { narrator: runner, artFor, typeDelay: opts.typeDelay ?? 0 },
  );
  const flush = () => Promise.all(writes);
  const started = ctl.start();
  const text = () => {
    const b = term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < b.length; y++) rows.push(b.getLine(y)!.translateToString(true));
    // Join Quill's wrapped rows (indented continuations) so sentences read whole.
    return rows.join('\n').replace(/\n {7}(?=\S)/g, ' ');
  };
  const type = async (s: string) => {
    await ctl.handleData(s);
    await flush();
  };
  return { ctl, runner, started, flush, text, type, term };
}

describe('playing the sample wing in the terminal', () => {
  it('opens with the wide banner, Quill, and the first instruction', async () => {
    const g = await game();
    await g.started;
    await g.flush();
    const t = g.text();
    expect(t).toContain('T  H  E     L  A  N  T  E  R  N');
    expect(t).toContain("Quill: Ah. You're awake.");
    expect(t).toContain('Quill: Type pwd and press Enter.');
    expect(t.trimEnd().endsWith('apprentice@archive:~$')).toBe(true);
  });

  it('uses the narrow banner on a phone-width screen', async () => {
    const g = await game({ cols: 41 });
    await g.started;
    await g.flush();
    expect(g.text()).toContain('T H E   L A N T E R N   H A L L');
  });

  it('plays from the first prompt to the end of the wing', async () => {
    const g = await game();
    await g.started;
    for (const line of [
      'pwd',
      'ls -a',
      'cat .under-the-floorboard',
      'cd /archive/lantern-hall',
      'cat lantern-log.txt',
      'cd',
    ]) {
      await g.type(line + '\r');
    }
    expect(g.runner.currentPhase).toBe('duties');
    const t = g.text();
    expect(t).toContain('Quill: A lion.');
    expect(t).toContain('Quill: Safe. For tonight.');
    expect(t).toContain('Small repairs first.');
    // Solve the first duty in the terminal too.
    for (const line of g.runner.current!.duty!.solution) await g.type(line + '\r');
    expect(g.text()).toMatch(/Quill: (Mended|Done|Good)\./);
  });

  it('hint and coaching appear as Quill lines after the command', async () => {
    const g = await game();
    await g.started;
    await g.type('hint\r');
    await g.type('dir\r');
    const t = g.text();
    expect(t).toContain('Quill: Ask the Lexicon where you are.');
    expect(t).toContain(
      'bash: dir: command not found\nQuill: `dir`'.replace('`dir`', 'dir is a spell'),
    );
  });

  it('types Quill out over time, and any key finishes the line at once', async () => {
    const g = await game({ typeDelay: 5 });
    await new Promise((r) => setTimeout(r, 30));
    await g.flush();
    expect(g.text()).not.toContain('Let us at least learn where we are.');
    await g.ctl.handleData(' '); // skip
    await g.started;
    await g.flush();
    expect(g.text()).toContain('Let us at least learn where we are.');
    expect(g.ctl.line.text).toBe(''); // a pure skip key is not typed
  });

  it('keys typed while Quill talks finish the line and are kept as type-ahead', async () => {
    const g = await game({ typeDelay: 5 });
    await new Promise((r) => setTimeout(r, 20));
    for (const k of 'pwd -P\r') await g.ctl.handleData(k); // one key at a time, like a fast typist
    await g.started;
    await g.flush();
    await g.flush();
    expect(g.runner.current?.step.id).toBe('ls');
  });

  it('skipSpeech() (a tap) finishes the line', async () => {
    const g = await game({ typeDelay: 5 });
    await new Promise((r) => setTimeout(r, 20));
    g.ctl.skipSpeech();
    await g.started;
    await g.flush();
    expect(g.text()).toContain('Type pwd and press Enter.');
  });
});

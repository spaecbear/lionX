import { createRegistry } from './commands';
import { defineCommand } from './commands/util';
import type { CoachingRule, QuillLines, Wing } from './content';
import {
  createDutyCommand,
  createHintCommand,
  createStatusCommand,
  LessonRunner,
  type Narration,
} from './narrative';
import { newProgress, type DutyTemplate } from './progression';
import { SAVE_VERSION, type SaveData } from './save';
import { Shell } from './shell';
import type { OutStream } from './commands/types';

/** Everything loaded from src/content that a play session needs. */
export interface GameContent {
  wings: Record<string, Wing>;
  dutyFiles: Record<string, DutyTemplate[]>;
  coaching: CoachingRule[];
  lines: QuillLines;
  /** The wing a new game begins in. */
  startWing: string;
}

export interface SessionOptions {
  content: GameContent;
  save?: SaveData;
  now?: () => number;
  /** A fresh seed for a new game (ignored when loading a save). */
  seed?: number;
  /** Called by `exit`, after its command finishes. */
  onExit?: () => void;
}

export interface GameSession {
  /** The current wing's runner (replaced when the player enters the next wing). */
  readonly runner: LessonRunner;
  shell: Shell;
  /** True when this session continues a save (so the UI shows `resume()`, not the opening). */
  resumed: boolean;
  /** Command history from the save, for the terminal's up arrow. */
  history: string[];
  /** What to show first: the wing's opening for a new game, or a welcome back for a save. */
  opening(): Narration[];
  /** After each command: the runner's response, plus the next wing's opening if the player just entered it. */
  afterCommand(line: string, status: number, stderr: string): Narration[];
  /** Capture the whole game as save data. */
  toSave(history: string[]): SaveData;
}

const quiet: OutStream = { write() {} };

/** Build a play session: a fresh game, or exactly where a save left off. */
export function createSession(o: SessionOptions): GameSession {
  const { content, save } = o;
  const wingId = save?.runner.wingId ?? content.startWing;
  const wing = content.wings[wingId];
  if (!wing) throw new Error(`Unknown wing "${wingId}"`);
  const now = o.now ?? Date.now;
  let runner = new LessonRunner(wing, {
    coaching: content.coaching,
    dutyFiles: content.dutyFiles,
    lines: content.lines,
    progress: save
      ? structuredClone(save.progress)
      : newProgress(o.seed ?? Math.floor(now() % 2 ** 32)),
    restore: save ? { vfs: save.vfs, runner: save.runner } : undefined,
    now,
  });

  // Bash's `exit` leaves the shell; here it leaves for the title screen (after saving).
  const exit = defineCommand({
    name: 'exit',
    unlockedInAct: 0,
    builtin: true,
    options: {},
    run() {
      if (o.onExit) queueMicrotask(o.onExit);
      return 0;
    },
  });

  const shell = new Shell({
    vfs: runner.vfs,
    registry: createRegistry().register(
      createHintCommand(() => runner),
      createStatusCommand(() => runner),
      createDutyCommand(() => runner),
      exit,
    ),
    terminal: { stdout: quiet, stderr: quiet },
    env: save?.env ?? {
      USER: runner.vfs.credentials.user,
      PWD: runner.vfs.cwd,
      TERM: 'xterm-256color',
    },
    onCommandRun: (name, args, status) => runner.recordCommand(name, args, status),
    isUnlocked: (cmd) => cmd.unlockedInAct === 0 || runner.knows(cmd.name),
  });

  /** If this wing is done and the player stands in the next wing's entrance, begin it. */
  const enterNextWing = (): Narration[] => {
    const nextId = runner.wing.next;
    const next = nextId ? content.wings[nextId] : undefined;
    if (!runner.done || !next?.entrance) return [];
    const entrance = runner.vfs.resolve(next.entrance);
    const cwd = runner.vfs.cwd;
    if (cwd !== entrance && !cwd.startsWith(entrance + '/')) return [];
    runner = new LessonRunner(next, {
      coaching: content.coaching,
      dutyFiles: content.dutyFiles,
      lines: content.lines,
      progress: runner.progress,
      vfs: runner.vfs,
      now,
    });
    return runner.start();
  };

  return {
    get runner() {
      return runner;
    },
    shell,
    resumed: !!save,
    history: save?.history ?? [],
    opening: () => (save ? runner.resume() : runner.start()),
    afterCommand: (line, status, stderr) => [
      ...runner.afterCommand(line, status, stderr),
      ...enterNextWing(),
    ],
    toSave: (history) => ({
      version: SAVE_VERSION,
      savedAt: now(),
      vfs: runner.vfs.serialize(),
      runner: runner.snapshot(),
      progress: structuredClone(runner.progress),
      env: Object.fromEntries(shell.env),
      history: history.slice(-200),
    }),
  };
}

import { createRegistry } from './commands';
import { defineCommand } from './commands/util';
import type { CoachingRule, QuillLines, Wing } from './content';
import {
  createDutyCommand,
  createHintCommand,
  createStatusCommand,
  LessonRunner,
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
  runner: LessonRunner;
  shell: Shell;
  /** True when this session continues a save (so the UI shows `resume()`, not the opening). */
  resumed: boolean;
  /** Command history from the save, for the terminal's up arrow. */
  history: string[];
  /** What to show first: the wing's opening for a new game, or a welcome back for a save. */
  opening(): import('./narrative').Narration[];
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
  const runner = new LessonRunner(wing, {
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

  return {
    runner,
    shell,
    resumed: !!save,
    history: save?.history ?? [],
    opening: () => (save ? runner.resume() : runner.start()),
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

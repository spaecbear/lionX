import { createRegistry } from './commands';
import type { Achievement, Library, CoachingRule, QuillLines, Secret, Wing } from './content';
import {
  createDutyCommand,
  createQuestsCommand,
  createHintCommand,
  createSolutionCommand,
  createHelpCommand,
  createAchievementsCommand,
  type Glossary,
  createStatusCommand,
  LessonRunner,
  type Narration,
} from './narrative';
import { newProgress, type DutyTemplate } from './progression';
import { SAVE_VERSION, type SaveData } from './save';
import { Shell } from './shell';
import { readCrontab } from './commands/cron';
import { BUILTINS, SPELL_MARKER } from './shell/executor';
import type { CommandRegistry } from './commands/types';
import type { Vfs } from './vfs';
import { ProcessTable } from './processes';
import type { OutStream } from './commands/types';

/** Everything loaded from src/content that a play session needs. */
export interface GameContent {
  wings: Record<string, Wing>;
  dutyFiles: Record<string, DutyTemplate[]>;
  coaching: CoachingRule[];
  lines: QuillLines;
  /** The wing a new game begins in. */
  startWing: string;
  /** Text of the post-game side quests list. */
  sideQuests?: string;
  /** The narrow text of an art piece (for ~/gallery). */
  artText?: (name: string) => string | undefined;
  /** What each spell and flag does, for `solution`. */
  glossary?: Glossary;
  /** Hidden notes that unlock themes and songs. */
  secrets?: Secret[];
  achievements?: Achievement[];
  library?: Library;
  /** The note in ~/.story-mode that tells of the secret story spell. */
  storyNote?: string;
}

export interface SessionOptions {
  content: GameContent;
  save?: SaveData;
  now?: () => number;
  /** A fresh seed for a new game (ignored when loading a save). */
  seed?: number;
  /** Easy mode: hints do not slow progress. */
  easy?: () => boolean;
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
  /** Resolves once ~/.bashrc has been read (aliases and PATH from it apply). */
  ready: Promise<void>;
  /** Capture the whole game as save data. */
  toSave(history: string[]): SaveData;
  /**
   * Story mode: the next command that moves the story on (from the solution,
   * or the walk to the next wing), or null when there is nothing left to do.
   * Marks the save as story-played, which turns achievements off for it.
   */
  nextStoryCommand(): StoryCommand | null;
  /** Story mode switched on or off (secrets are not found while it is on). */
  setStoryActive(on: boolean): void;
}

/** One command for story mode to type: Tab after it, or a password when asked. */
export interface StoryCommand {
  line: string;
  tab?: boolean;
  password?: string;
}

/** Commands from a final hint like "Type: a   then press Tab   then: b   then enter your password: x". */
export function storyFromHint(hint: string): StoryCommand[] {
  const m = /Type(?: exactly)?:\s*(.+)$/.exec(hint);
  if (!m) return [];
  return m[1]
    .split(/\s+then:\s+/)
    .map((part) => ({
      line: part.split(/\s+then (?:press|enter)\b/)[0].trim(),
      tab: /press Tab/.test(part) || undefined,
      password: /then enter your password: (\S+)/.exec(part)?.[1],
    }))
    .filter((c) => c.line);
}

const quiet: OutStream = { write() {} };

export const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';
const DEFAULT_BASHRC = `# ~/.bashrc: read by the Lexicon each time it wakes.
export PATH=${DEFAULT_PATH}
`;

/**
 * Every spell that is not a shell builtin lives as a file in /usr/bin, so
 * PATH means what it means on a real system. Only missing files are written.
 */
export function installSpells(vfs: Vfs, registry: CommandRegistry): void {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    for (const d of ['/bin', '/usr/bin', '/usr/local/bin'])
      if (!vfs.exists(d)) vfs.mkdir(d, { parents: true });
    if (!vfs.exists('/tmp')) {
      vfs.mkdir('/tmp');
      vfs.chmod('/tmp', 0o1777);
    }
    for (const name of registry.names()) {
      const path = `/usr/bin/${name}`;
      if (BUILTINS.has(name) || vfs.exists(path)) continue;
      vfs.writeFile(
        path,
        `${SPELL_MARKER}${name}\nThe spell of ${name}, written in the Archive's old tongue.\n`,
      );
      vfs.chmod(path, 0o755);
    }
  } finally {
    vfs.credentials = saved;
  }
  const rc = `${vfs.home}/.bashrc`;
  if (!vfs.exists(rc)) {
    const savedCreds = vfs.credentials;
    vfs.credentials = { user: 'root', groups: ['root'] };
    try {
      vfs.writeFile(rc, DEFAULT_BASHRC);
      vfs.chown(rc, savedCreds.user, savedCreds.groups[0]);
    } finally {
      vfs.credentials = savedCreds;
    }
  }
}

/** Build a play session: a fresh game, or exactly where a save left off. */
export function createSession(o: SessionOptions): GameSession {
  const { content, save } = o;
  const wingId = save?.runner.wingId ?? content.startWing;
  const wing = content.wings[wingId];
  if (!wing) throw new Error(`Unknown wing "${wingId}"`);
  const now = o.now ?? Date.now;
  const processes = save?.processes
    ? ProcessTable.load(save.processes, now)
    : new ProcessTable(now);
  let runner = new LessonRunner(wing, {
    processes,
    coaching: content.coaching,
    dutyFiles: content.dutyFiles,
    lines: content.lines,
    artText: content.artText,
    glossary: content.glossary,
    easy: o.easy,
    secrets: content.secrets,
    achievements: content.achievements,
    library: content.library,
    progress: save
      ? structuredClone(save.progress)
      : newProgress(o.seed ?? Math.floor(now() % 2 ** 32)),
    restore: save ? { vfs: save.vfs, runner: save.runner } : undefined,
    now,
  });

  const shell = new Shell({
    vfs: runner.vfs,
    registry: createRegistry().register(
      createHintCommand(() => runner),
      createSolutionCommand(() => runner),
      createHelpCommand(() => runner, content.glossary),
      createAchievementsCommand(() => runner, content.achievements ?? []),
      createStatusCommand(() => runner),
      createDutyCommand(() => runner),
      createQuestsCommand(() => runner, content.sideQuests ?? ''),
    ),
    onExit: o.onExit,
    terminal: { stdout: quiet, stderr: quiet },
    env: save?.env ?? {
      USER: runner.vfs.credentials.user,
      PWD: runner.vfs.cwd,
      TERM: 'xterm-256color',
      PATH: DEFAULT_PATH,
    },
    onCommandRun: (name, args, status) => runner.recordCommand(name, args, status),
    processes,
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
      processes,
      coaching: content.coaching,
      dutyFiles: content.dutyFiles,
      lines: content.lines,
      artText: content.artText,
      glossary: content.glossary,
      easy: o.easy,
      secrets: content.secrets,
      achievements: content.achievements,
      library: content.library,
      progress: runner.progress,
      vfs: runner.vfs,
      now,
    });
    runner.shellState = shellState;
    runner.storyActive = storyOn;
    return runner.start();
  };

  const quietIo = {
    stdin: '',
    stdinIsTerminal: true,
    stdoutIsTerminal: false,
    stdout: quiet,
    stderr: quiet,
  };
  /** Handle runner events that reach into the shell. */
  const handleEvents = (ns: Narration[]): Narration[] => {
    if (ns.some((n) => n.kind === 'event' && n.event === 'reload-shell')) {
      void shell.source(`${runner.vfs.home}/.bashrc`, quietIo, { trusted: true });
    }
    return ns;
  };

  if (save?.jobs) shell.jobs?.restore(save.jobs);
  const shellState = { env: shell.env, exported: shell.exported, aliases: shell.aliases };
  runner.shellState = shellState;
  installSpells(runner.vfs, shell.registry);
  // The secret story spell is written under the desk, for whoever looks with ls -a.
  const note = `${runner.vfs.home}/.story-mode`;
  if (content.storyNote && !runner.vfs.exists(note)) runner.vfs.writeFile(note, content.storyNote);
  // Immortal spirits (lionX) return only while their owner's crontab still calls them back.
  processes.respawnGuard = (spec) => (readCrontab(runner.vfs, spec.user) ?? '').includes(spec.name);
  if (!shell.env.has('PATH')) shell.env.set('PATH', DEFAULT_PATH);
  // Like a login shell, read ~/.bashrc (trusted: startup files may use spells not yet learned).
  const ready = shell
    .source(
      `${runner.vfs.home}/.bashrc`,
      { stdin: '', stdinIsTerminal: true, stdoutIsTerminal: false, stdout: quiet, stderr: quiet },
      { trusted: true },
    )
    .then(
      () => undefined,
      () => undefined,
    );

  let storyOn = false;
  let storyQueue: StoryCommand[] = [];
  let storyKey = '';
  const nextStoryCommand = (): StoryCommand | null => {
    runner.progress.storyMode = true;
    const cur = runner.current;
    if (!cur) {
      // Between wings: walk to the next one's door.
      const next = runner.wing.next ? content.wings[runner.wing.next] : undefined;
      if (runner.done && next?.entrance) return { line: `cd ${next.entrance}` };
      return null;
    }
    const key = `${runner.wing.id}:${cur.kind}:${cur.lessonIndex}:${cur.step.id}:${cur.duty?.signature ?? ''}`;
    if (key !== storyKey || storyQueue.length === 0) {
      storyKey = key;
      const fromHint = storyFromHint(cur.step.hints.at(-1) ?? '');
      storyQueue = fromHint.length
        ? fromHint
        : (cur.duty?.solution ?? []).map((line) => ({ line }));
    }
    return storyQueue.shift() ?? null;
  };

  return {
    get runner() {
      return runner;
    },
    nextStoryCommand,
    setStoryActive: (on) => {
      storyOn = on;
      runner.storyActive = on;
      if (on) runner.progress.storyMode = true;
    },
    shell,
    resumed: !!save,
    history: save?.history ?? [],
    ready,
    opening: () => (save ? runner.resume() : runner.start()),
    afterCommand: (line, status, stderr) =>
      handleEvents([...runner.afterCommand(line, status, stderr), ...enterNextWing()]),
    toSave: (history) => ({
      version: SAVE_VERSION,
      savedAt: now(),
      vfs: runner.vfs.serialize(),
      runner: runner.snapshot(),
      progress: structuredClone(runner.progress),
      env: Object.fromEntries(shell.env),
      history: history.slice(-200),
      processes: processes.snapshot(),
      jobs: shell.jobs?.snapshot() ?? [],
    }),
  };
}

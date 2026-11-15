import type {
  CoachingRule,
  GuideLevel,
  Lesson,
  QuillLines,
  Reward,
  Secret,
  Achievement,
  Library,
  Step,
  Wing,
} from '../content';
import { GUIDE_LEVELS } from '../content';
import {
  GAIN,
  applyTask,
  DEFAULT_GATE,
  gateOpen,
  generateDuty,
  isSwift,
  newProgress,
  nextDifficulty,
  Rng,
  type Duty,
  type DutyTemplate,
  type ProgressState,
  type TaskResult,
} from '../progression';
import { evaluate, type CommandEvent } from '../validator';
import { commandsFromHint, explain, type Glossary } from './explain';
import { manPageFor } from '../commands/util';
import { applyPatch, buildWorld, Vfs, type VfsSnapshot } from '../vfs';
import type { ProcessTable } from '../processes';
import type { WorldPatch } from '../content';

/** Something the UI should present, in order. */
export type Narration =
  /** A line spoken by Quill (typewriter effect in the UI). */
  | { kind: 'quill'; text: string; who?: 'lombra' }
  /** The narrator: what happens around the player, not anyone's speech. */
  | { kind: 'narrator'; text: string }
  /** An achievement, just earned. */
  | { kind: 'achievement'; title: string; says: string }
  /** A command, explained piece by piece (the `solution` spell). */
  | { kind: 'breakdown'; command: string; pieces: [string, string][] }
  /** An ASCII art piece by name; the UI picks the narrow or wide variant. */
  | { kind: 'art'; name: string; reward?: boolean }
  /** Quiet marker for progress (no text). */
  | {
      kind: 'event';
      event:
        | 'step-complete'
        | 'lesson-complete'
        | 'duty-complete'
        | 'capstone-open'
        | 'wing-complete'
        | 'reward'
        | 'secret'
        | 'spells-changed'
        | 'reload-shell';
      id: string;
    };

export type Phase = 'lessons' | 'duties' | 'capstone' | 'free';

/** Where the runner is, as plain JSON, so a save can put the player back exactly. */
export interface RunnerSnapshot {
  wingId: string;
  phase: Phase;
  lessonIndex: number;
  stepIndex: number;
  hintsUsed: number;
  struggled: boolean;
  level: GuideLevel;
  duty: Duty | null;
  commands: CommandEvent[];
  reads: string[];
}

export interface RunnerOptions {
  /** Shared coaching for common mistakes, checked after the wing's own rules. */
  coaching?: CoachingRule[];
  /** What each spell and flag does, for the `solution` spell. */
  glossary?: Glossary;
  /** Easy mode: hints no longer slow mastery (asked fresh at each task's end). */
  easy?: () => boolean;
  /** Hidden notes that unlock cosmetics, placed as their wing begins. */
  secrets?: Secret[];
  /** The Book of Eco: pages filed in ~/library. */
  library?: Library;
  /** Achievements, checked after every command. */
  achievements?: Achievement[];
  /** Every loaded duty template, by file id. The wing names which files it draws from. */
  dutyFiles?: Record<string, DutyTemplate[]>;
  /** Quill's fixed lines for duties, swift casting, and the gate. */
  lines?: QuillLines;
  /** Progress carried in from earlier wings or a save. */
  progress?: ProgressState;
  /** The world's processes; patches may start spirits in it. */
  processes?: ProcessTable;
  /** Continue in an existing world (entering a later wing). */
  vfs?: Vfs;
  /** The narrow (40 column) text of an art piece, for hanging it in ~/gallery. */
  artText?: (name: string) => string | undefined;
  /** Resume from a save instead of starting the wing fresh. */
  restore?: { vfs: VfsSnapshot; runner: RunnerSnapshot };
  now?: () => number;
}

export interface TaskState {
  kind: 'step' | 'duty' | 'capstone';
  lesson?: Lesson;
  step: Step;
  duty?: Duty;
  lessonIndex: number;
  stepIndex: number;
  /** Guidance level Quill used for this task. */
  level: GuideLevel;
  hintsUsed: number;
}

const FALLBACK_LINES: QuillLines = {
  swift: ['Swift casting.'],
  dutyDone: ['Done.'],
  noDuty: 'Nothing needs mending right now.',
  idle: 'Nothing needs mending here right now. Wander as you like.',
  gateSealed: 'The way forward is still sealed.',
  gateOpen: 'Something stirs at the far end of the hall.',
  resume: 'Welcome back.',
};

/**
 * Runs one wing: lessons, then practice duties until the wing's spells are
 * strong enough, then the capstone, then free play. Headless: it returns
 * Narration and never touches the screen.
 *
 * Fading: each step names its most hands-off guidance (exact command, then the
 * goal, then only the problem). If the player needed hints on the previous
 * task, Quill steps one level back toward spelling it out.
 */
export class LessonRunner {
  readonly vfs: Vfs;
  readonly progress: ProgressState;
  private phase: Phase = 'lessons';
  private lessonIndex = 0;
  private stepIndex = 0;
  private hintsUsed = 0;
  private struggled = false;
  private level: GuideLevel = 'exact';
  private commands: CommandEvent[] = [];
  private reads = new Set<string>();
  private pending: Narration[] = [];
  private duty: Duty | null = null;
  private rng: Rng;
  readonly lines: QuillLines;
  private templates: DutyTemplate[];
  /** Total hints used per task id, for tests and tuning. */
  readonly hintLog = new Map<string, number>();

  constructor(
    readonly wing: Wing,
    private opts: RunnerOptions = {},
  ) {
    if (opts.restore && opts.restore.runner.wingId !== wing.id) {
      throw new Error(`Save is for wing "${opts.restore.runner.wingId}", not "${wing.id}"`);
    }
    if (opts.restore) this.vfs = Vfs.load(opts.restore.vfs, { now: opts.now });
    else if (opts.vfs) {
      this.vfs = opts.vfs;
      if (wing.setup) this.patch(wing.setup);
    } else if (wing.world) this.vfs = buildWorld(wing.world, { now: opts.now });
    else
      throw new Error(`Wing "${wing.id}" has no world of its own; enter it from an earlier wing`);
    this.vfs.onRead = (p) => {
      this.reads.add(p);
      this.noticeSecret(p);
    };
    this.progress = opts.progress ?? newProgress();
    this.rng = new Rng(this.progress.rngState);
    this.lines = opts.lines ?? FALLBACK_LINES;
    // Templates from the files this wing names (list earlier wings' files to mix in older spells).
    this.templates = (wing.duties ?? []).flatMap((id) => opts.dutyFiles?.[id] ?? []);
    if (opts.restore) {
      const r = opts.restore.runner;
      this.phase = r.phase;
      this.lessonIndex = r.lessonIndex;
      this.stepIndex = r.stepIndex;
      this.hintsUsed = r.hintsUsed;
      this.struggled = r.struggled;
      this.level = r.level;
      this.duty = r.duty;
      this.commands = [...r.commands];
      this.reads = new Set(r.reads);
    }
  }

  /** The shell's variables and aliases, for goals about them (set by the session). */
  shellState?: { env: Map<string, string>; exported: Set<string>; aliases: Map<string, string> };

  /** Pids of spirits the current duty started, removed when it ends. */
  private dutyPids: number[] = [];

  /** Apply a world patch: files and dirs, then any processes it starts. Returns new pids. */
  private patch(p: WorldPatch, opts: { ownedByPlayer?: boolean } = {}): number[] {
    applyPatch(this.vfs, p, this.user, opts);
    const table = this.opts.processes;
    if (!table || !p.processes) return [];
    return p.processes.map(
      (spec) => table.spawn({ ...spec, user: spec.user ?? this.user.name }).pid,
    );
  }

  /** The player's account, for placing files in their home. */
  get user() {
    return {
      name: this.vfs.credentials.user,
      groups: [...this.vfs.credentials.groups],
      home: this.vfs.home,
    };
  }

  snapshot(): RunnerSnapshot {
    return structuredClone({
      wingId: this.wing.id,
      phase: this.phase,
      lessonIndex: this.lessonIndex,
      stepIndex: this.stepIndex,
      hintsUsed: this.hintsUsed,
      struggled: this.struggled,
      level: this.level,
      duty: this.duty,
      commands: this.commands,
      reads: [...this.reads],
    });
  }

  /** After loading a save: a word from Quill, then the current instruction again. */
  resume(): Narration[] {
    return [{ kind: 'quill', text: this.lines.resume }, ...this.repeat()];
  }

  /** The wing's capstone is solved (or, for a wing without one, its lessons are done). */
  get done(): boolean {
    return this.phase === 'free';
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Spells taught so far: these are unlocked. */
  get known(): string[] {
    return [...this.progress.known];
  }

  knows(spell: string): boolean {
    return this.progress.known.includes(spell);
  }

  /** Every spell this wing teaches. */
  get wingSpells(): string[] {
    return [...new Set(this.wing.lessons.flatMap((l) => l.spells))];
  }

  get current(): TaskState | null {
    const base = {
      lessonIndex: this.lessonIndex,
      stepIndex: this.stepIndex,
      level: this.level,
      hintsUsed: this.hintsUsed,
    };
    if (this.phase === 'lessons') {
      const lesson = this.wing.lessons[this.lessonIndex];
      return { ...base, kind: 'step', lesson, step: lesson.steps[this.stepIndex] };
    }
    if (this.phase === 'capstone')
      return { ...base, kind: 'capstone', step: this.wing.capstone!.steps[this.stepIndex] };
    if (this.duty) return { ...base, kind: 'duty', step: dutyStep(this.duty), duty: this.duty };
    return null;
  }

  /** Opening: banner, wing intro, first lesson, first step. */
  start(): Narration[] {
    const out: Narration[] = [];
    if (this.wing.banner) out.push({ kind: 'art', name: this.wing.banner });
    out.push(...quill(this.wing.intro));
    out.push(...this.beginLesson());
    this.placeSecrets();
    out.push(...this.placePages());
    return out;
  }

  /** Record a command as it runs (wire to Shell.onCommandRun). */
  recordCommand(command: string, args: string[], status: number): void {
    this.commands.push({ command, args, status });
    if (status === 0) {
      const used = (this.progress.used ??= []);
      if (!used.includes(command)) used.push(command);
    }
  }

  /**
   * Called after each line the player submits. Checks the goal, advances,
   * or offers coaching for a recognizable mistake.
   */
  afterCommand(line: string, status: number, stderr: string): Narration[] {
    const out = this.respond(line, status, stderr);
    return [...out, ...this.checkAchievements()];
  }

  /** Newly earned achievements, in order. */
  checkAchievements(): Narration[] {
    const p = this.progress;
    const earned = (p.achievements ??= []);
    const out: Narration[] = [];
    for (const a of this.opts.achievements ?? []) {
      if (earned.includes(a.id) || !this.achieved(a)) continue;
      earned.push(a.id);
      out.push({ kind: 'achievement', title: a.title, says: a.says });
    }
    return out;
  }

  private achieved(a: Achievement): boolean {
    const p = this.progress;
    const w = a.when;
    if ('wingDone' in w) return p.wingsDone.includes(w.wingDone);
    if ('dutiesDone' in w) return p.dutiesDone >= w.dutiesDone;
    if ('swift' in w) return (p.swift ?? 0) >= w.swift;
    if ('gallery' in w) return (p.gallery?.length ?? 0) >= w.gallery;
    if ('secrets' in w)
      return (
        (p.secrets?.length ?? 0) >= (w.secrets === 'all' ? this.secretCount || Infinity : w.secrets)
      );
    if ('spells' in w) return p.known.length >= w.spells && (p.used?.length ?? 0) > 0;
    if ('used' in w) return p.used?.includes(w.used) ?? false;
    if ('library' in w) {
      const total = this.opts.library?.pages.length ?? Infinity;
      return (p.library?.length ?? 0) >= (w.library === 'all' ? total : w.library);
    }
    return false;
  }

  private respond(line: string, status: number, stderr: string): Narration[] {
    const out = [...this.pending.splice(0), ...this.announceSecrets(), ...this.announcePages()];
    // Rooms appear as lessons go on; hide any secret whose room now exists.
    this.placeSecrets();
    out.push(...this.placePages());
    this.fillGrimoire();
    if (line.trim() === '') return out;
    const cur = this.current;
    if (!cur) return out;
    if (this.goalMet(cur.step)) {
      out.push(...this.completeTask());
      return out;
    }
    if (/^\s*(hint|solution|status|duty)\b/.test(line)) return out;
    const advice = this.coach(cur.step, line, status, stderr) ?? this.nearMiss(cur.step);
    if (advice) out.push(speech(advice));
    return out;
  }

  /** The `hint` spell: a nudge, then the spell's name, then the full syntax. */
  hint(): Narration[] {
    const cur = this.current;
    if (!cur) return [{ kind: 'quill', text: this.lines.idle }];
    const i = Math.min(this.hintsUsed, 2);
    this.hintsUsed = Math.min(this.hintsUsed + 1, 3);
    this.hintLog.set(cur.step.id, (this.hintLog.get(cur.step.id) ?? 0) + 1);
    // Restate the objective first, so a hint is never a riddle without its question.
    const objective = cur.step.guidance[cur.level];
    const hint = cur.step.hints[i];
    return [
      ...(objective && objective !== hint ? [{ kind: 'quill' as const, text: objective }] : []),
      { kind: 'quill', text: hint },
      // Stuck on a duty even at the last hint: offer the way out.
      ...(cur.duty && i === 2 && this.lines.skipReminder
        ? [{ kind: 'quill' as const, text: this.lines.skipReminder }]
        : []),
    ];
  }

  /** The `solution` spell: one way to finish the task, each piece explained. Counts as full help. */
  solution(): Narration[] {
    const cur = this.current;
    if (!cur) return [{ kind: 'quill', text: this.lines.idle }];
    const commands = cur.duty ? cur.duty.solution : commandsFromHint(cur.step.hints.at(-1) ?? '');
    const glossary = this.opts.glossary;
    if (!commands.length || !glossary) return this.hint();
    this.hintsUsed = 3;
    this.hintLog.set(cur.step.id, (this.hintLog.get(cur.step.id) ?? 0) + 1);
    return [
      ...this.repeat(),
      { kind: 'quill', text: this.lines.solutionIntro ?? 'Here is one way, piece by piece:' },
      ...commands.map((command) => ({
        kind: 'breakdown' as const,
        command,
        pieces: explain(command, glossary),
      })),
    ];
  }

  /** The player stands in a room named like the goal's, but in the wrong place. */
  private nearMiss(step: Step): string | null {
    const say = this.lines.wrongPlace;
    if (!say) return null;
    const targets: string[] = [];
    const walk = (p: unknown) => {
      if (!p || typeof p !== 'object') return;
      const o = p as Record<string, unknown>;
      if (typeof o.cwdIs === 'string') targets.push(this.vfs.resolve(o.cwdIs));
      for (const k of ['all', 'any']) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(walk);
    };
    walk(step.goal);
    const here = this.vfs.cwd;
    const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    const there = targets.find((t) => t !== here && base(t) === base(here));
    return there ? say.replace('{here}', here).replace('{there}', there) : null;
  }

  /**
   * `duty skip`: abandon the current duty (say, its materials were lost) and
   * take a fresh one. Nothing is earned for the skipped one.
   */
  skipDuty(): Narration[] {
    if (!this.duty) return [{ kind: 'quill', text: this.lines.noSkip ?? this.lines.noDuty }];
    this.cleanup(this.duty);
    this.duty = null;
    const out: Narration[] = [{ kind: 'quill', text: this.lines.dutySkipped ?? 'Fair enough.' }];
    if (this.phase === 'free') return out;
    return [...out, ...this.assignDuty()];
  }

  /** The `duty` spell: ask for restoration work during free play. */
  requestDuty(): Narration[] {
    if (this.current) return this.repeat();
    return this.assignDuty();
  }

  /** Queue narration to be returned by the next afterCommand (used by in-world spells). */
  queue(lines: Narration[]): void {
    this.pending.push(...lines);
  }

  /** Repeat the current instruction. */
  repeat(): Narration[] {
    const cur = this.current;
    return cur ? [{ kind: 'quill', text: cur.step.guidance[cur.level]! }] : [];
  }

  /**
   * For `status`: while practicing duties, how many more clean (hint-free)
   * duties each spell still needs before the capstone opens. An estimate:
   * hints and swift casting change it.
   */
  dutiesToGate(): { spell: string; left: number }[] | null {
    if (this.phase !== 'duties' || this.gateIsOpen()) return null;
    const gate = this.wing.gate ?? DEFAULT_GATE;
    return this.gatedSpells()
      .map((spell) => ({
        spell,
        left: Math.ceil(Math.max(0, gate - (this.progress.mastery[spell] ?? 0)) / GAIN.clean),
      }))
      .filter((x) => x.left > 0);
  }

  /** Easy mode is on right now. */
  get easy(): boolean {
    return this.opts.easy?.() ?? false;
  }

  /** Whether the capstone is open (for the `status` spell). */
  gateIsOpen(): boolean {
    return (
      this.phase === 'capstone' ||
      this.phase === 'free' ||
      gateOpen(this.progress.mastery, this.gatedSpells(), this.wing.gate ?? DEFAULT_GATE)
    );
  }

  /**
   * The wing spells the gate waits on: those some duty can practice. A spell
   * no duty uses can never grow, and must not lock the player out.
   */
  private gatedSpells(): string[] {
    const practicable = new Set(this.templates.flatMap((t) => t.spells));
    return this.wingSpells.filter((s) => practicable.has(s));
  }

  get statusLine(): string {
    return this.gateIsOpen() ? this.lines.gateOpen : this.lines.gateSealed;
  }

  // ------------------------------------------------------------ internals

  private weakSpells(): string[] {
    const gate = this.wing.gate ?? DEFAULT_GATE;
    const weak = this.gatedSpells().filter((s) => (this.progress.mastery[s] ?? 0) < gate);
    return weak.length ? weak : this.wingSpells;
  }

  private goalMet(step: Step): boolean {
    return evaluate(step.goal, {
      vfs: this.vfs,
      commands: this.commands,
      reads: this.reads,
      processes: this.opts.processes?.names() ?? [],
      niceness: (name) => this.opts.processes?.byName(name).map((p) => p.nice) ?? [],
      shell: this.shellState,
    });
  }

  private coach(step: Step, line: string, status: number, stderr: string): string | null {
    const rules = [
      ...(step.coaching ?? []),
      ...(this.wing.coaching ?? []),
      ...(this.opts.coaching ?? []),
    ];
    for (const r of rules) {
      if (r.failed && status === 0) continue;
      if (r.line !== undefined && !new RegExp(r.line).test(line)) continue;
      if (r.stderr !== undefined && !new RegExp(r.stderr).test(stderr)) continue;
      return r.say;
    }
    return null;
  }

  private learn(spells: string[]): Narration[] {
    const fresh = spells.filter((s) => !this.progress.known.includes(s));
    if (fresh.length === 0) return [];
    this.progress.known.push(...fresh);
    this.fillGrimoire();
    return [{ kind: 'event', event: 'spells-changed', id: fresh.join(',') }];
  }

  /**
   * Once the player knows `man`, every spell they know has a page in
   * ~/grimoire, readable with cat or less. New spells add new pages.
   */
  private fillGrimoire(): void {
    if (!this.progress.known.includes('man')) return;
    const dir = `${this.user.home}/grimoire`;
    const files: Record<string, string> = {};
    for (const spell of this.progress.known) {
      const page = manPageFor(spell);
      if (page && !asRootExists(this.vfs, `${dir}/${spell}`)) files[`${dir}/${spell}`] = page;
    }
    if (Object.keys(files).length) this.patch({ files }, { ownedByPlayer: true });
  }

  private beginLesson(): Narration[] {
    const lesson = this.wing.lessons[this.lessonIndex];
    if (lesson.setup) this.patch(lesson.setup);
    return [...this.learn(lesson.spells), ...quill(lesson.intro), ...this.beginStep()];
  }

  /** Reset per-task tracking and give the instruction at the right level of help. */
  private beginStep(): Narration[] {
    const step = this.current!.step;
    this.commands = [];
    this.reads.clear();
    const wanted = GUIDE_LEVELS.indexOf(step.guide);
    this.level = GUIDE_LEVELS[Math.max(0, wanted - (this.struggled ? 1 : 0))];
    this.hintsUsed = 0;
    return [{ kind: 'quill', text: step.guidance[this.level]! }];
  }

  /** Spells cast successfully during this task. */
  private spellsUsed(): string[] {
    return [
      ...new Set(
        this.commands.filter((c) => c.status === 0 && this.knows(c.command)).map((c) => c.command),
      ),
    ];
  }

  private recordMastery(required: string[], par?: number): TaskResult {
    const result: TaskResult = {
      required,
      used: this.spellsUsed(),
      hints: this.hintsUsed,
      commands: this.commands.length,
      par,
    };
    // Easy mode: a task finished with hints counts as clean (but never as swift).
    const easy = this.opts.easy?.() && this.hintsUsed > 0;
    applyTask(this.progress.mastery, easy ? { ...result, hints: 0, par: undefined } : result);
    this.struggled = this.hintsUsed > 0;
    return result;
  }

  private completeTask(): Narration[] {
    if (this.phase === 'duties' || (this.phase === 'free' && this.duty)) return this.completeDuty();
    if (this.phase === 'capstone') return this.completeCapstoneStep();
    return this.completeLessonStep();
  }

  private completeLessonStep(): Narration[] {
    const lesson = this.wing.lessons[this.lessonIndex];
    const step = lesson.steps[this.stepIndex];
    this.recordMastery(lesson.spells.filter((s) => this.spellsUsed().includes(s)));
    const out: Narration[] = [
      ...this.reward(step.art),
      ...quill(step.success),
      { kind: 'event', event: 'step-complete', id: step.id },
    ];
    if (this.stepIndex + 1 < lesson.steps.length) {
      this.stepIndex++;
      return [...out, ...this.beginStep()];
    }
    out.push(...quill(lesson.outro), { kind: 'event', event: 'lesson-complete', id: lesson.id });
    if (this.lessonIndex + 1 < this.wing.lessons.length) {
      this.lessonIndex++;
      this.stepIndex = 0;
      return [...out, ...this.beginLesson()];
    }
    return [...out, ...this.afterLessons()];
  }

  /** Lessons done: practice duties if the wing has a capstone to earn, else the wing is complete. */
  private afterLessons(): Narration[] {
    if (!this.wing.capstone) return this.finishWing();
    this.phase = 'duties';
    const out = quill(this.wing.practice?.intro);
    if (this.gateIsOpen()) return [...out, ...this.openCapstone()];
    return [...out, ...this.assignDuty()];
  }

  private assignDuty(): Narration[] {
    const duty = generateDuty(this.templates, {
      known: this.progress.known,
      // Practice what is weakest: spells still below the gate, falling back to all wing spells.
      focus: this.weakSpells(),
      difficulty: this.progress.difficulty,
      rng: this.rng,
      recent: this.progress.recentDuties,
      exists: (p) => this.vfs.exists(p) || asRootExists(this.vfs, p),
    });
    this.progress.rngState = this.rng.state;
    if (!duty) {
      // No duty fits what the player knows; skip straight to the capstone if there is one.
      if (this.phase === 'duties') return this.openCapstone();
      return [{ kind: 'quill', text: this.lines.noDuty }];
    }
    this.duty = duty;
    this.progress.recentDuties = [...this.progress.recentDuties, duty.signature].slice(-30);
    // Duty material is the player's to work with: they own what the duty creates.
    if (duty.setup) this.dutyPids = this.patch(duty.setup, { ownedByPlayer: true });
    this.stepIndex = 0;
    return this.beginStep();
  }

  private completeDuty(): Narration[] {
    const duty = this.duty!;
    const result = this.recordMastery(duty.spells, duty.par);
    this.progress.difficulty = nextDifficulty(this.progress.difficulty, result);
    this.progress.dutiesDone++;
    this.cleanup(duty);
    this.duty = null;
    const swift = isSwift(result);
    if (swift) this.progress.swift = (this.progress.swift ?? 0) + 1;
    const out: Narration[] = [
      ...this.reward(duty.art),
      { kind: 'quill', text: duty.success ?? this.rng.pick(this.lines.dutyDone) },
      ...(swift ? [{ kind: 'quill' as const, text: this.rng.pick(this.lines.swift) }] : []),
      { kind: 'event', event: 'duty-complete', id: duty.signature },
      ...this.giveRewards(),
    ];
    this.progress.rngState = this.rng.state;
    if (this.phase === 'free') return out;
    if (this.gateIsOpen()) return [...out, ...this.openCapstone()];
    return [...out, ...this.assignDuty()];
  }

  private cleanup(duty: Duty) {
    for (const pid of this.dutyPids) this.opts.processes?.remove(pid);
    this.dutyPids = [];
    const saved = this.vfs.credentials;
    this.vfs.credentials = { user: 'root', groups: ['root'] };
    try {
      for (const p of duty.cleanup) {
        // "process:NAME" removes spirits the player raised for this duty.
        if (p.startsWith('process:')) {
          for (const proc of this.opts.processes?.byName(p.slice(8)) ?? [])
            this.opts.processes!.remove(proc.pid);
          continue;
        }
        // Never pull the floor out from under the player.
        const abs = this.vfs.resolve(p);
        if (this.vfs.cwd === abs || this.vfs.cwd.startsWith(abs + '/')) continue;
        if (this.vfs.exists(p)) this.vfs.remove(p, { recursive: true });
      }
    } finally {
      this.vfs.credentials = saved;
    }
  }

  /**
   * Reward art for a finished task: one of the named variants, drawn in the
   * terminal, and hung in ~/gallery the first time it is earned.
   */
  private reward(art: string[] | undefined): Narration[] {
    if (!art?.length) return [];
    const name = this.rng.pick(art);
    const out: Narration[] = [{ kind: 'art', name, reward: true }];
    const gallery = (this.progress.gallery ??= []);
    const text = this.opts.artText?.(name);
    if (!gallery.includes(name) && text) {
      gallery.push(name);
      this.patch({ files: { [`${this.user.home}/gallery/${name}`]: text } });
      if (gallery.length === 1 && this.lines.galleryNew)
        out.push({ kind: 'quill', text: this.lines.galleryNew });
    }
    return out;
  }

  /** Hide this wing's secrets (those not yet found), where their room exists. */
  private placeSecrets(): void {
    const found = this.progress.secrets ?? [];
    for (const s of this.opts.secrets ?? []) {
      if (!this.reached(s.wing) || found.includes(s.id)) continue;
      const dir = s.file.slice(0, s.file.lastIndexOf('/')) || '/';
      if (!asRootExists(this.vfs, dir) || asRootExists(this.vfs, s.file)) continue;
      this.patch({ files: { [s.file]: s.text } });
    }
  }

  /** This wing is being played, or was finished before (so older saves get its findables too). */
  private reached(wing: string): boolean {
    return wing === this.wing.id || this.progress.wingsDone.includes(wing);
  }

  /** Place pages of the Book of Eco whose wing (and `after`) has come. */
  private placePages(): Narration[] {
    const lib = this.opts.library;
    if (!lib) return [];
    const found = this.progress.library ?? [];
    const out: Narration[] = [];
    for (const p of lib.pages) {
      if (!this.reached(p.wing) || found.includes(p.id)) continue;
      if (p.after && !this.progress.wingsDone.includes(p.after)) continue;
      const dir = p.file.slice(0, p.file.lastIndexOf('/')) || '/';
      if (!asRootExists(this.vfs, dir) || asRootExists(this.vfs, p.file)) continue;
      this.patch(
        { files: { [p.file]: p.text } },
        { ownedByPlayer: p.file.startsWith(this.user.home) },
      );
      if (p.appears) out.push({ kind: 'narrator', text: p.appears });
    }
    return out;
  }

  private pagesJustFound: string[] = [];

  /** File found pages on the shelf, in order, with placeholders for the gaps. */
  private announcePages(): Narration[] {
    const lib = this.opts.library;
    const ids = this.pagesJustFound.splice(0);
    if (!lib || ids.length === 0) return [];
    const found = (this.progress.library ??= []);
    const first = found.length === 0;
    for (const id of ids) if (!found.includes(id)) found.push(id);
    const dir = `${this.user.home}/library`;
    const files: Record<string, string> = {};
    const gone: string[] = [];
    lib.pages.forEach((p, i) => {
      const n = String(i + 1).padStart(2, '0');
      if (found.includes(p.id)) {
        files[`${dir}/${n}-${p.id}`] = p.text;
        gone.push(`${dir}/${n}-missing`);
      } else {
        files[`${dir}/${n}-missing`] = lib.missing
          .replace('{n}', String(i + 1))
          .replace('{where}', p.where);
      }
    });
    this.patch({ files }, { ownedByPlayer: true });
    asRoot(this.vfs, () => {
      for (const g of gone) if (this.vfs.exists(g)) this.vfs.remove(g);
    });
    const done = found.length >= lib.pages.length;
    return [
      ...(done ? this.reward(['echo']) : []),
      { kind: 'narrator', text: done ? lib.complete : first ? lib.firstFiled : lib.filed },
    ];
  }

  /** A secret was read: unlock its theme or song, and let the narrator say so. */
  private noticeSecret(path: string): void {
    const page = this.opts.library?.pages.find((p) => p.file === path);
    if (
      page &&
      !(this.progress.library ?? []).includes(page.id) &&
      !this.pagesJustFound.includes(page.id)
    )
      this.pagesJustFound.push(page.id);
    const s = this.opts.secrets?.find((x) => x.file === path);
    const found = (this.progress.secrets ??= []);
    if (!s || found.includes(s.id)) return;
    found.push(s.id);
    if (s.theme && !this.progress.themes.includes(s.theme)) this.progress.themes.push(s.theme);
    if (s.song) {
      const songs = (this.progress.songs ??= []);
      if (!songs.includes(s.song)) songs.push(s.song);
    }
    // The art (and its gallery copy) waits until the command finishes: no writing mid-read.
    this.secretsJustFound.push(s);
  }

  private secretsJustFound: Secret[] = [];

  /** Art and words for secrets found during the last command. */
  private announceSecrets(): Narration[] {
    return this.secretsJustFound
      .splice(0)
      .flatMap((s): Narration[] => [
        ...this.reward(s.art ? [s.art] : undefined),
        { kind: 'narrator', text: s.say },
        { kind: 'event', event: 'secret', id: s.id },
      ]);
  }

  /** How many secrets exist, for `status`. */
  get secretCount(): number {
    return this.opts.secrets?.length ?? 0;
  }

  private giveRewards(): Narration[] {
    const out: Narration[] = [];
    for (const r of this.wing.rewards ?? []) {
      if (this.progress.rewardsGiven.includes(r.id) || this.progress.dutiesDone < r.afterDuties)
        continue;
      this.progress.rewardsGiven.push(r.id);
      this.grant(r);
      out.push({ kind: 'narrator', text: r.say }, { kind: 'event', event: 'reward', id: r.id });
    }
    return out;
  }

  private grant(r: Reward) {
    const home = this.user.home;
    const files: Record<string, string> = {};
    if (r.lore) {
      files[`${home}/${r.lore.file}`] = r.lore.text;
      this.progress.lore.push(r.id);
    }
    if (r.decoration) files[`${home}/${r.decoration.file}`] = r.decoration.content;
    if (r.theme && !this.progress.themes.includes(r.theme)) this.progress.themes.push(r.theme);
    if (Object.keys(files).length) applyPatch(this.vfs, { files }, this.user);
  }

  private openCapstone(): Narration[] {
    const cap = this.wing.capstone;
    if (!cap) return this.finishWing();
    this.phase = 'capstone';
    this.duty = null;
    this.stepIndex = 0;
    if (cap.setup) this.patch(cap.setup);
    return [
      ...(cap.reloadShell
        ? [{ kind: 'event' as const, event: 'reload-shell' as const, id: this.wing.id }]
        : []),
      ...quill(this.wing.practice?.gateOpens),
      { kind: 'event', event: 'capstone-open', id: this.wing.id },
      ...quill(cap.intro),
      ...this.beginStep(),
    ];
  }

  private completeCapstoneStep(): Narration[] {
    const cap = this.wing.capstone!;
    const step = cap.steps[this.stepIndex];
    this.recordMastery(this.wingSpells.filter((s) => this.spellsUsed().includes(s)));
    const out: Narration[] = [
      ...this.reward(step.art),
      ...quill(step.success),
      { kind: 'event', event: 'step-complete', id: step.id },
    ];
    if (this.stepIndex + 1 < cap.steps.length) {
      this.stepIndex++;
      return [...out, ...this.beginStep()];
    }
    if (cap.unlocks) this.patch(cap.unlocks);
    return [...out, ...quill(cap.outro), ...this.finishWing()];
  }

  private finishWing(): Narration[] {
    this.phase = 'free';
    if (!this.progress.wingsDone.includes(this.wing.id)) this.progress.wingsDone.push(this.wing.id);
    return [...quill(this.wing.outro), { kind: 'event', event: 'wing-complete', id: this.wing.id }];
  }
}

/** Present a duty through the same step machinery as lessons. */
function dutyStep(d: Duty): Step {
  return {
    id: d.signature,
    goal: d.goal,
    guide: 'problem',
    guidance: { exact: d.hints[2], goal: d.brief, problem: d.brief },
    hints: d.hints,
  };
}

function asRoot<T>(vfs: Vfs, f: () => T): T {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    return f();
  } finally {
    vfs.credentials = saved;
  }
}

function asRootExists(vfs: Vfs, p: string): boolean {
  const saved = vfs.credentials;
  vfs.credentials = { user: 'root', groups: ['root'] };
  try {
    return vfs.exists(p);
  } finally {
    vfs.credentials = saved;
  }
}

/**
 * Turn content lines into speech. Quill speaks by default; a line starting
 * "@lombra " is L'Ombra's, and "@narrator " is the narrator's.
 */
export function speech(text: string): Narration {
  const m = /^@(lombra|narrator) (.*)$/s.exec(text);
  if (!m) return { kind: 'quill', text };
  if (m[1] === 'narrator') return { kind: 'narrator', text: m[2] };
  return { kind: 'quill', text: m[2], who: 'lombra' };
}

function quill(lines: string[] | undefined): Narration[] {
  return (lines ?? []).map(speech);
}

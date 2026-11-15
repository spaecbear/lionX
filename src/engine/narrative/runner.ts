import type { CoachingRule, GuideLevel, Lesson, Step, Wing } from '../content';
import { GUIDE_LEVELS } from '../content';
import { evaluate, type CommandEvent } from '../validator';
import { applyPatch, buildWorld, type Vfs } from '../vfs';

/** Something the UI should present, in order. */
export type Narration =
  /** A line spoken by Quill (typewriter effect in the UI). */
  | { kind: 'quill'; text: string }
  /** An ASCII art piece by name; the UI picks the narrow or wide variant. */
  | { kind: 'art'; name: string }
  /** Quiet marker that a lesson or wing finished (no text). */
  | { kind: 'event'; event: 'step-complete' | 'lesson-complete' | 'wing-complete'; id: string };

export interface RunnerOptions {
  /** Shared coaching for common mistakes, checked after the wing's own rules. */
  coaching?: CoachingRule[];
  now?: () => number;
}

export interface StepState {
  lesson: Lesson;
  step: Step;
  lessonIndex: number;
  stepIndex: number;
  /** Guidance level Quill used for this step. */
  level: GuideLevel;
  hintsUsed: number;
}

/**
 * Runs one wing: Quill's lines, step goals, fading guidance, hints, and
 * coaching. Headless: it never touches the screen, it returns Narration.
 *
 * Fading: each step names its most hands-off guidance (exact command, then the
 * goal, then only the problem). If the player needed hints on the previous
 * step, Quill steps one level back toward spelling it out.
 */
export class LessonRunner {
  readonly vfs: Vfs;
  private lessonIndex = 0;
  private stepIndex = 0;
  private hintsUsed = 0;
  private struggled = false;
  private level: GuideLevel = 'exact';
  private commands: CommandEvent[] = [];
  private reads = new Set<string>();
  private pending: Narration[] = [];
  private finished = false;
  /** Total hints used per step id, for tests and future mastery tracking. */
  readonly hintLog = new Map<string, number>();

  constructor(
    readonly wing: Wing,
    private opts: RunnerOptions = {},
  ) {
    this.vfs = buildWorld(wing.world, { now: opts.now });
    this.vfs.onRead = (p) => this.reads.add(p);
  }

  get done(): boolean {
    return this.finished;
  }

  get current(): StepState | null {
    if (this.finished) return null;
    const lesson = this.wing.lessons[this.lessonIndex];
    return {
      lesson,
      step: lesson.steps[this.stepIndex],
      lessonIndex: this.lessonIndex,
      stepIndex: this.stepIndex,
      level: this.level,
      hintsUsed: this.hintsUsed,
    };
  }

  /** Opening: banner, wing intro, first lesson, first step. */
  start(): Narration[] {
    const out: Narration[] = [];
    if (this.wing.banner) out.push({ kind: 'art', name: this.wing.banner });
    out.push(...quill(this.wing.intro));
    out.push(...this.beginLesson());
    return out;
  }

  /** Record a command as it runs (wire to Shell.onCommandRun). */
  recordCommand(command: string, args: string[], status: number): void {
    this.commands.push({ command, args, status });
  }

  /**
   * Called after each line the player submits. Checks the goal, advances,
   * or offers coaching for a recognizable mistake.
   */
  afterCommand(line: string, status: number, stderr: string): Narration[] {
    const out = this.pending.splice(0);
    if (this.finished || line.trim() === '') return out;
    const cur = this.current!;
    if (this.goalMet(cur.step)) {
      out.push(...this.completeStep());
      return out;
    }
    if (/^\s*hint\b/.test(line)) return out;
    const advice = this.coach(cur.step, line, status, stderr);
    if (advice) out.push({ kind: 'quill', text: advice });
    return out;
  }

  /** The `hint` spell: a nudge, then the spell's name, then the full syntax. */
  hint(): Narration[] {
    if (this.finished)
      return [{ kind: 'quill', text: 'Nothing needs mending here right now. Wander as you like.' }];
    const cur = this.current!;
    const i = Math.min(this.hintsUsed, 2);
    this.hintsUsed = Math.min(this.hintsUsed + 1, 3);
    this.hintLog.set(cur.step.id, (this.hintLog.get(cur.step.id) ?? 0) + 1);
    return [{ kind: 'quill', text: cur.step.hints[i] }];
  }

  /** Queue narration to be returned by the next afterCommand (used by the `hint` spell). */
  queue(lines: Narration[]): void {
    this.pending.push(...lines);
  }

  /** Repeat the current instruction. */
  repeat(): Narration[] {
    const cur = this.current;
    return cur ? [{ kind: 'quill', text: cur.step.guidance[cur.level]! }] : [];
  }

  private goalMet(step: Step): boolean {
    return evaluate(step.goal, {
      vfs: this.vfs,
      commands: this.commands,
      reads: this.reads,
      processes: [],
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

  private beginLesson(): Narration[] {
    const lesson = this.wing.lessons[this.lessonIndex];
    if (lesson.setup) applyPatch(this.vfs, lesson.setup, this.wing.world.user);
    return [...quill(lesson.intro), ...this.beginStep()];
  }

  private beginStep(): Narration[] {
    const step = this.wing.lessons[this.lessonIndex].steps[this.stepIndex];
    this.commands = [];
    this.reads.clear();
    const wanted = GUIDE_LEVELS.indexOf(step.guide);
    this.level = GUIDE_LEVELS[Math.max(0, wanted - (this.struggled ? 1 : 0))];
    this.hintsUsed = 0;
    return [{ kind: 'quill', text: step.guidance[this.level]! }];
  }

  private completeStep(): Narration[] {
    const lesson = this.wing.lessons[this.lessonIndex];
    const step = lesson.steps[this.stepIndex];
    const out: Narration[] = [
      ...quill(step.success),
      { kind: 'event', event: 'step-complete', id: step.id },
    ];
    this.struggled = this.hintsUsed > 0;
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
    this.finished = true;
    return [
      ...out,
      ...quill(this.wing.outro),
      { kind: 'event', event: 'wing-complete', id: this.wing.id },
    ];
  }
}

function quill(lines: string[] | undefined): Narration[] {
  return (lines ?? []).map((text) => ({ kind: 'quill', text }));
}

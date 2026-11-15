import type { Predicate } from '../validator';
import type { WorldSpec } from '../vfs';

/** How much Quill spells out a step: the exact command, the goal, or only the problem. */
export type GuideLevel = 'exact' | 'goal' | 'problem';
export const GUIDE_LEVELS: GuideLevel[] = ['exact', 'goal', 'problem'];

/** Extra dirs and files placed into the world (as root) when a lesson begins. */
export interface WorldPatch {
  dirs?: WorldSpec['dirs'];
  files?: WorldSpec['files'];
}

/** A specific reply to a common mistake. Regexes match the typed line and/or the error output. */
export interface CoachingRule {
  line?: string;
  stderr?: string;
  /** Only when the command failed (non-zero status). Defaults to any status. */
  failed?: boolean;
  say: string;
}

export interface Step {
  id: string;
  goal: Predicate;
  /** The most hands-off guidance this step uses. Quill steps back toward `exact` for players who needed hints. */
  guide: GuideLevel;
  guidance: Partial<Record<GuideLevel, string>>;
  /** Exactly three: a nudge, the spell's name, then the full syntax. */
  hints: [string, string, string];
  success?: string[];
  coaching?: CoachingRule[];
}

export interface Lesson {
  id: string;
  /** Spells this lesson teaches (for chips and, later, mastery). */
  spells: string[];
  setup?: WorldPatch;
  intro?: string[];
  steps: Step[];
  outro?: string[];
}

export interface Wing {
  id: string;
  /** Art name: art/<banner>.narrow.txt and art/<banner>.wide.txt. */
  banner?: string;
  world: WorldSpec;
  intro?: string[];
  lessons: Lesson[];
  outro?: string[];
  coaching?: CoachingRule[];
}

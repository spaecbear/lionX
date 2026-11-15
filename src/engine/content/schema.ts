import type { Predicate } from '../validator';
import type { WorldSpec } from '../vfs';

/** How much Quill spells out a step: the exact command, the goal, or only the problem. */
export type GuideLevel = 'exact' | 'goal' | 'problem';
export const GUIDE_LEVELS: GuideLevel[] = ['exact', 'goal', 'problem'];

/** Extra dirs and files placed into the world (as root) when a lesson begins. */
export interface WorldPatch {
  dirs?: WorldSpec['dirs'];
  files?: WorldSpec['files'];
  /** Generated files: many pages from a short description (see vfs/corpus.ts). */
  corpus?: WorldSpec['corpus'];
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

export interface Reward {
  id: string;
  /** Given once this many duties are done (across the whole game). */
  afterDuties: number;
  say: string;
  /** A lore fragment written into the player's cell as a readable file. */
  lore?: { file: string; text: string };
  /** A decoration placed in the cell (any file path under home). */
  decoration?: { file: string; content: string };
  /** A terminal theme the player can switch to later. */
  theme?: string;
}

export interface Capstone {
  intro?: string[];
  steps: Step[];
  outro?: string[];
  /** World changes when solved: the way to the next wing opens. */
  unlocks?: WorldPatch;
}

export interface Practice {
  /** Quill, when duties begin after the lessons. */
  intro?: string[];
  /** Quill, when the wing's spells are strong enough for the capstone. */
  gateOpens?: string[];
}

export interface Wing {
  id: string;
  /** Duty template files (src/content/duties/<id>.yaml) this wing draws from. */
  duties?: string[];
  /** Mastery every wing spell needs before the capstone appears (0-100, default 60). */
  gate?: number;
  practice?: Practice;
  capstone?: Capstone;
  rewards?: Reward[];
  /** Art name: art/<banner>.narrow.txt and art/<banner>.wide.txt. */
  banner?: string;
  /** The starting world. Required for the first wing; later wings continue the same world. */
  world?: WorldSpec;
  /** Added to the world when the player enters this wing (later wings). */
  setup?: WorldPatch;
  /** Walking into this directory (once the previous wing is done) begins this wing. */
  entrance?: string;
  /** The wing that follows this one. */
  next?: string;
  intro?: string[];
  lessons: Lesson[];
  outro?: string[];
  coaching?: CoachingRule[];
}

/** Fixed lines Quill uses for game events (src/content/quill.yaml). */
export interface QuillLines {
  swift: string[];
  dutyDone: string[];
  noDuty: string;
  idle: string;
  gateSealed: string;
  gateOpen: string;
  resume: string;
}

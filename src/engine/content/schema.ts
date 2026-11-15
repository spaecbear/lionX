import type { Predicate } from '../validator';
import type { ProcSpec } from '../processes';
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
  /** Processes (spirits) to start. `user` defaults to the player. */
  processes?: (Omit<ProcSpec, 'user'> & { user?: string })[];
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
  /** Art shown when the step is done (one name, or variants picked at random). */
  art?: string[];
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

/** What earns an achievement (exactly one key). */
export type AchievementWhen =
  | { wingDone: string }
  | { dutiesDone: number }
  | { swift: number }
  | { gallery: number }
  | { secrets: number | 'all' }
  | { spells: number }
  | { used: string }
  | { library: number | 'all' };

export interface Achievement {
  id: string;
  title: string;
  says: string;
  /** Shown as ??? until earned. */
  hidden?: boolean;
  when: AchievementWhen;
}

/** One page of the Book of Eco, filed in ~/library when read. */
export interface LibraryPage {
  id: string;
  title: string;
  /** Placed once this wing begins. */
  wing: string;
  /** And only after this wing is mended. */
  after?: string;
  file: string;
  text: string;
  /** Narrator, when it is placed somewhere visible. */
  appears?: string;
  /** The hint on its placeholder while missing. */
  where: string;
}

export interface Library {
  title: string;
  firstFiled: string;
  filed: string;
  complete: string;
  missing: string;
  pages: LibraryPage[];
}

/** A hidden note that unlocks one cosmetic (a theme or a song) when read. */
export interface Secret {
  id: string;
  /** Placed when this wing begins. */
  wing: string;
  file: string;
  text: string;
  /** The narrator, when it is found. */
  say: string;
  theme?: string;
  song?: string;
  /** Art drawn when found, and hung in ~/gallery. */
  art?: string;
  /** Quill points the player to it: story mode reads it too. */
  guided?: boolean;
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
  /** World changes when the capstone opens (the trouble it is about). */
  setup?: WorldPatch;
  /** After setup, the Lexicon re-reads ~/.bashrc at once (so changes to it take hold). */
  reloadShell?: boolean;
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
  /** Said the first time a piece of art is added to ~/gallery. */
  galleryNew?: string;
  /** Said when the player stands in a room with the right name in the wrong place. {here}, {there}. */
  wrongPlace?: string;
  /** Said before the `solution` spell's breakdown. */
  solutionIntro?: string;
  /** `duty skip`: said when a duty is abandoned. */
  dutySkipped?: string;
  /** `duty skip` with no duty to skip. */
  noSkip?: string;
  /** Added to hints on a duty once the last hint is reached. */
  skipReminder?: string;
  /** status, while practicing: {n} duties until the trial ({s}: y/ies). */
  untilTrial?: string;
  /** The same, in easy mode (hints count). */
  untilTrialEasy?: string;
}

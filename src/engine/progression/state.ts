/** Everything about the player's progress, as plain JSON (saved in Phase 8). */
export interface ProgressState {
  /** Spell -> mastery 0..100. */
  mastery: Record<string, number>;
  /** Spells the player has been taught (unlocked). */
  known: string[];
  difficulty: number;
  dutiesDone: number;
  /** Signatures of recent duties, to avoid repeats. */
  recentDuties: string[];
  rngState: number;
  lore: string[];
  themes: string[];
  /** Ids of rewards already given. */
  rewardsGiven: string[];
  /** Wings whose capstone is solved. */
  wingsDone: string[];
  /** Art pieces earned and hung in ~/gallery. */
  gallery?: string[];
  /** Ids of secrets found. */
  secrets?: string[];
  /** Songs unlocked by secrets. */
  songs?: string[];
}

export function newProgress(seed = 1): ProgressState {
  return {
    mastery: {},
    known: [],
    difficulty: 1,
    dutiesDone: 0,
    recentDuties: [],
    rngState: seed >>> 0,
    lore: [],
    themes: [],
    rewardsGiven: [],
    wingsDone: [],
  };
}

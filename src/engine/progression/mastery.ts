/**
 * Per-spell mastery from 0 to 100. Clean, unassisted casting raises it; hints
 * lower it slightly. The player only ever sees flavor text, never numbers.
 */
export const MASTERY_MAX = 100;
export const DEFAULT_GATE = 60;

export const GAIN = {
  /** A required spell used to finish a task without hints. */
  clean: 15,
  /** Extra for finishing within par (the "swift casting" note). */
  swift: 10,
  /** A required spell used after taking hints. */
  assisted: 4,
  /** Taken off each required spell per hint used. */
  perHint: -3,
  /** Any other known spell cast successfully along the way. */
  incidental: 3,
};

export interface TaskResult {
  /** Spells the task was about. */
  required: string[];
  /** Spells cast successfully while doing it. */
  used: string[];
  hints: number;
  commands: number;
  /** Expected number of commands for a tidy solution, if known. */
  par?: number;
}

/** True when the task was done without hints and within par. */
export function isSwift(r: TaskResult): boolean {
  return r.hints === 0 && r.par !== undefined && r.commands <= r.par;
}

/** Apply a finished task to mastery scores (mutates and returns `mastery`). */
export function applyTask(mastery: Record<string, number>, r: TaskResult): Record<string, number> {
  const add = (spell: string, n: number) => {
    mastery[spell] = Math.max(0, Math.min(MASTERY_MAX, (mastery[spell] ?? 0) + n));
  };
  const used = new Set(r.used);
  for (const spell of r.required) {
    if (r.hints > 0) {
      add(spell, (used.has(spell) ? GAIN.assisted : 0) + GAIN.perHint * r.hints);
    } else if (used.has(spell)) {
      add(spell, GAIN.clean + (isSwift(r) ? GAIN.swift : 0));
    }
  }
  for (const spell of used) if (!r.required.includes(spell)) add(spell, GAIN.incidental);
  return mastery;
}

/** Adaptive difficulty 1..3: swift, clean work climbs; leaning on hints eases off. */
export function nextDifficulty(current: number, r: TaskResult): number {
  if (isSwift(r)) return Math.min(3, current + 1);
  if (r.hints >= 2) return Math.max(1, current - 1);
  return current;
}

export function gateOpen(
  mastery: Record<string, number>,
  spells: string[],
  threshold = DEFAULT_GATE,
): boolean {
  return spells.every((s) => (mastery[s] ?? 0) >= threshold);
}

/** How the `status` spell describes a spell's mastery. */
export function masteryPhrase(spell: string, score: number): string {
  if (score <= 0) return `You have not truly cast ${spell} yet.`;
  if (score < 25) return `Your grasp of ${spell} flickers.`;
  if (score < 50) return `Your grasp of ${spell} grows steady.`;
  if (score < 75) return `Your grasp of ${spell} holds firm.`;
  if (score < MASTERY_MAX) return `You cast ${spell} without a second thought.`;
  return `${spell} answers you like an old friend.`;
}

import { loadCoaching, loadDuties, loadQuillLines, loadWing } from '../engine/content';
import type { GameContent } from '../engine/session';
import { coachingSource, dutySources, quillSource, wingSources } from '.';

/** The wing a new game begins in. Phase 9 replaces the sample with the real opening wing. */
export const START_WING = 'lantern-hall';

/** Parse every content file into what a play session needs. */
export function loadGameContent(): GameContent {
  return {
    wings: Object.fromEntries(
      Object.entries(wingSources).map(([id, src]) => [id, loadWing(src, `${id}.yaml`)]),
    ),
    dutyFiles: Object.fromEntries(
      Object.entries(dutySources).map(([id, src]) => [id, loadDuties(src, `${id}.yaml`)]),
    ),
    coaching: loadCoaching(coachingSource),
    lines: loadQuillLines(quillSource),
    startWing: START_WING,
  };
}

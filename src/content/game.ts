import {
  loadCoaching,
  loadDuties,
  loadQuillLines,
  loadSecrets,
  loadAchievements,
  loadLibrary,
  loadWing,
} from '../engine/content';
import librarySource from './library.yaml?raw';
import storySource from './story.yaml?raw';
import { parse as parseYaml } from 'yaml';
import achievementsSource from './achievements.yaml?raw';
import secretsSource from './secrets.yaml?raw';
import { loadGlossary } from '../engine/narrative';
import type { GameContent } from '../engine/session';
import { art, glossarySource, coachingSource, dutySources, quillSource, wingSources } from '.';
import sideQuests from './side-quests.txt?raw';

/** The wing a new game begins in. (lantern-hall is a small sample wing kept for tests.) */
export const START_WING = 'apprentice-cells';

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
    sideQuests,
    artText: (name) => art(name, 'narrow'),
    glossary: loadGlossary(glossarySource),
    secrets: loadSecrets(secretsSource),
    achievements: loadAchievements(achievementsSource),
    library: loadLibrary(librarySource),
    storyNote: (parseYaml(storySource) as { note: string }).note,
  };
}

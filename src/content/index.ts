/**
 * Loads the game's data files. Everything here is plain text: YAML for wings
 * and coaching, .txt for art. Nothing is game logic.
 */
import coachingYaml from './coaching.yaml?raw';

const wingFiles = import.meta.glob<string>('./wings/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const artFiles = import.meta.glob<string>('./art/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const coachingSource = coachingYaml;

/** Raw YAML for each wing, by id (file name without extension). */
export const wingSources: Record<string, string> = Object.fromEntries(
  Object.entries(wingFiles).map(([path, text]) => [path.replace(/^.*\/(.+)\.yaml$/, '$1'), text]),
);

export type ArtVariant = 'narrow' | 'wide';
export const NARROW_ART_COLS = 40;
export const WIDE_ART_COLS = 80;

/** Art text by name and variant, or undefined if missing. */
export function art(name: string, variant: ArtVariant): string | undefined {
  return artFiles[`./art/${name}.${variant}.txt`];
}

/** Every art piece name found in the art folder. */
export function artNames(): string[] {
  return [
    ...new Set(Object.keys(artFiles).map((p) => p.replace(/^.*\/(.+)\.(narrow|wide)\.txt$/, '$1'))),
  ].sort();
}

/** The art for a screen `cols` wide: wide at 80+ columns, else narrow. */
export function artFor(name: string, cols: number): string | undefined {
  return art(name, cols >= WIDE_ART_COLS ? 'wide' : 'narrow') ?? art(name, 'narrow');
}

import quillYaml from './quill.yaml?raw';

const dutyFiles = import.meta.glob<string>('./duties/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const quillSource = quillYaml;

/** Raw YAML for each duty template file, by id. */
export const dutySources: Record<string, string> = Object.fromEntries(
  Object.entries(dutyFiles).map(([path, text]) => [path.replace(/^.*\/(.+)\.yaml$/, '$1'), text]),
);

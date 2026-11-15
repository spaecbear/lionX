/**
 * The soundtrack's composer: pure functions that turn music.yaml into notes
 * for one bar at a time. No Web Audio here, so it runs in tests.
 */
import { parse } from 'yaml';

export interface Mood {
  bpm: number;
  swing: number;
  chords: string[][];
  melody: string[];
  drums: { kick: string; snare: string; hat: string };
}

export interface MusicData {
  default: string;
  moods: Record<string, Mood>;
}

export type Voice = 'keys' | 'bass' | 'lead' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  voice: Voice;
  /** Seconds from the start of the bar. */
  at: number;
  /** Seconds. */
  dur: number;
  /** Hz (0 for drums). */
  freq: number;
  /** 0 to 1. */
  vel: number;
}

const DRUMS = ['kick', 'snare', 'hat'] as const;

export function loadMusic(source: string): MusicData {
  const raw = parse(source) as MusicData;
  if (!raw?.moods || typeof raw.moods !== 'object') throw new Error('music.yaml: no moods');
  for (const [name, m] of Object.entries(raw.moods)) {
    const where = `music.yaml: mood ${name}`;
    if (!(m.bpm > 0)) throw new Error(`${where}: bpm must be positive`);
    if (!(m.swing >= 0 && m.swing < 0.5)) throw new Error(`${where}: swing must be 0 to 0.5`);
    if (!m.chords?.length) throw new Error(`${where}: needs chords`);
    for (const c of m.chords) for (const n of c) noteFreq(n, where);
    for (const n of m.melody ?? []) noteFreq(n, where);
    for (const d of DRUMS)
      if (!/^[x.]{16}$/.test(m.drums?.[d] ?? ''))
        throw new Error(`${where}: drums.${d} must be 16 steps of x and .`);
  }
  if (!raw.moods[raw.default]) throw new Error(`music.yaml: default mood ${raw.default} missing`);
  return raw;
}

const SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Frequency of a note name like A4, C#3 or Bb2 (A4 = 440 Hz). */
export function noteFreq(name: string, where = 'note'): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`${where}: bad note ${name}`);
  const semi = SEMIS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semi;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Seconds per bar of 4 beats. */
export function barLength(mood: Mood): number {
  return (60 / mood.bpm) * 4;
}

/** Start of 16th step `i` within a bar, with swing pushing the off-beats late. */
export function stepTime(mood: Mood, i: number): number {
  const sixteenth = 60 / mood.bpm / 4;
  return i * sixteenth + (i % 2 === 1 ? mood.swing * sixteenth : 0);
}

/** The notes of bar number `bar` of a mood. `rand` gives 0..1 (seeded in tests). */
export function composeBar(mood: Mood, bar: number, rand: () => number): NoteEvent[] {
  const out: NoteEvent[] = [];
  const len = barLength(mood);
  const beat = len / 4;
  const chord = mood.chords[bar % mood.chords.length].map((n) => noteFreq(n));

  // Keys: the chord, lightly strummed, held for the bar.
  chord.forEach((f, i) =>
    out.push({ voice: 'keys', at: i * 0.025, dur: len * 0.95, freq: f, vel: 0.5 + rand() * 0.15 }),
  );
  // Sometimes a soft re-strike on beat 3.
  if (rand() < 0.4)
    chord.forEach((f, i) =>
      out.push({ voice: 'keys', at: beat * 2.5 + i * 0.02, dur: beat * 1.4, freq: f, vel: 0.3 }),
    );

  // Bass: the root an octave down, on 1 and the "and" of 3.
  const root = chord[0] / 2;
  out.push({ voice: 'bass', at: 0, dur: beat * 2.2, freq: root, vel: 0.8 });
  out.push({ voice: 'bass', at: stepTime(mood, 10), dur: beat * 1.3, freq: root, vel: 0.6 });

  // Drums.
  for (const d of DRUMS) {
    const pattern = mood.drums[d];
    for (let i = 0; i < 16; i++) {
      if (pattern[i] !== 'x') continue;
      const vel = d === 'hat' ? (i % 4 === 0 ? 0.5 : 0.3) + rand() * 0.15 : 0.8 + rand() * 0.2;
      out.push({ voice: d, at: stepTime(mood, i), dur: 0.2, freq: 0, vel });
    }
  }

  // A wandering melody: a few notes, leaving space, never every bar.
  if (mood.melody?.length && rand() < 0.6) {
    const count = 1 + Math.floor(rand() * 3);
    const steps = new Set<number>();
    while (steps.size < count) steps.add(Math.floor(rand() * 7) * 2);
    for (const i of [...steps].sort((a, b) => a - b)) {
      const name = mood.melody[Math.floor(rand() * mood.melody.length)];
      out.push({
        voice: 'lead',
        at: stepTime(mood, i),
        dur: beat * (0.8 + rand()),
        freq: noteFreq(name),
        vel: 0.35 + rand() * 0.2,
      });
    }
  }
  return out;
}

/** Which mood plays: the wing's own if it has one, else the default. */
export function moodFor(music: MusicData, wingId: string | undefined): string {
  return wingId && music.moods[wingId] ? wingId : music.default;
}

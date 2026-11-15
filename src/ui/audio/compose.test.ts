import musicYaml from '../../content/music.yaml?raw';
import { wingSources } from '../../content';
import { barLength, composeBar, loadMusic, moodFor, noteFreq, stepTime } from './compose';

function seeded(seed = 1) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

describe('soundtrack composer', () => {
  const music = loadMusic(musicYaml);

  it('tunes notes to A440', () => {
    expect(noteFreq('A4')).toBeCloseTo(440);
    expect(noteFreq('A3')).toBeCloseTo(220);
    expect(noteFreq('C4')).toBeCloseTo(261.63, 1);
    expect(noteFreq('C#4')).toBeCloseTo(noteFreq('Db4'));
    expect(() => noteFreq('H2')).toThrow('bad note H2');
  });

  it('has a mood for the title and every wing', () => {
    expect(music.moods.title).toBeDefined();
    for (const id of Object.keys(wingSources)) expect(moodFor(music, id)).toMatch(/./);
    expect(moodFor(music, 'apprentice-cells')).toBe('apprentice-cells');
    expect(moodFor(music, 'nowhere')).toBe('title');
  });

  it('swings the off-beats late', () => {
    const m = music.moods.title;
    const sixteenth = 60 / m.bpm / 4;
    expect(stepTime(m, 2)).toBeCloseTo(2 * sixteenth);
    expect(stepTime(m, 1)).toBeGreaterThan(sixteenth);
  });

  it('writes every bar within the bar, following the chord loop', () => {
    for (const [name, m] of Object.entries(music.moods)) {
      const rand = seeded(7);
      for (let bar = 0; bar < 8; bar++) {
        const ev = composeBar(m, bar, rand);
        const len = barLength(m);
        for (const e of ev) {
          expect(e.at, name).toBeGreaterThanOrEqual(0);
          expect(e.at, name).toBeLessThan(len);
          expect(e.vel).toBeLessThanOrEqual(1);
        }
        const keys = ev.filter((e) => e.voice === 'keys').slice(0, 4);
        expect(keys.map((k) => k.freq)).toEqual(
          m.chords[bar % m.chords.length].map((n) => noteFreq(n)),
        );
        expect(ev.filter((e) => e.voice === 'kick').length).toBe(
          [...m.drums.kick].filter((c) => c === 'x').length,
        );
      }
    }
  });

  it('rejects broken music files', () => {
    expect(() => loadMusic('default: a\nmoods: {}')).toThrow('default mood a missing');
    expect(() =>
      loadMusic(
        'default: a\nmoods:\n  a: {bpm: 70, swing: 0.2, chords: [[C3]], drums: {kick: "x", snare: "x", hat: "x"}}',
      ),
    ).toThrow('drums.kick must be 16 steps');
  });
});

import { loadCoaching, loadWing } from '../engine/content';
import {
  art,
  artFor,
  artNames,
  coachingSource,
  NARROW_ART_COLS,
  WIDE_ART_COLS,
  wingSources,
} from '.';

describe('content files', () => {
  it.each(Object.keys(wingSources))('wing %s loads and its banner art exists', (id) => {
    const wing = loadWing(wingSources[id], `${id}.yaml`);
    expect(wing.id).toBe(id);
    if (wing.banner) expect(artNames()).toContain(wing.banner);
  });

  it('shared coaching loads', () => {
    expect(loadCoaching(coachingSource).length).toBeGreaterThan(3);
  });

  it.each(artNames())('art %s has narrow (40 col) and wide (80 col) variants', (name) => {
    const narrow = art(name, 'narrow');
    const wide = art(name, 'wide');
    expect(narrow, 'narrow variant').toBeDefined();
    expect(wide, 'wide variant').toBeDefined();
    for (const l of narrow!.split('\n')) expect(l.length).toBeLessThanOrEqual(NARROW_ART_COLS);
    for (const l of wide!.split('\n')) expect(l.length).toBeLessThanOrEqual(WIDE_ART_COLS);
  });

  it('artFor picks wide at 80 columns and narrow below', () => {
    expect(artFor('lantern', 80)).toBe(art('lantern', 'wide'));
    expect(artFor('lantern', 41)).toBe(art('lantern', 'narrow'));
    expect(artFor('nothing', 80)).toBeUndefined();
  });
});

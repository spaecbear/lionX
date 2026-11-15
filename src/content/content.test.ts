import { loadCoaching, loadDuties, loadQuillLines, loadSecrets, loadWing } from '../engine/content';
import secretsSource from './secrets.yaml?raw';
import {
  art,
  artFor,
  artNames,
  coachingSource,
  dutySources,
  NARROW_ART_COLS,
  quillSource,
  WIDE_ART_COLS,
  wingSources,
} from '.';

describe('content files', () => {
  it.each(Object.keys(wingSources))('wing %s loads and its banner art exists', (id) => {
    const wing = loadWing(wingSources[id], `${id}.yaml`);
    expect(wing.id).toBe(id);
    if (wing.banner) expect(artNames()).toContain(wing.banner);
  });

  it('every reward art a step or duty names exists', () => {
    const names: string[] = [];
    for (const [id, src] of Object.entries(wingSources)) {
      const w = loadWing(src, id);
      for (const l of w.lessons) for (const s of l.steps) names.push(...(s.art ?? []));
      for (const s of w.capstone?.steps ?? []) names.push(...(s.art ?? []));
    }
    for (const [id, src] of Object.entries(dutySources))
      for (const d of loadDuties(src, id)) names.push(...(d.art ?? []));
    for (const sec of loadSecrets(secretsSource)) names.push(sec.art!);
    names.push('ribbon');
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(artNames(), n).toContain(n);
  });

  it.each(Object.keys(dutySources))('duty file %s loads', (id) => {
    expect(loadDuties(dutySources[id], `${id}.yaml`).length).toBeGreaterThan(0);
  });

  it('every duty file a wing names exists', () => {
    for (const [id, src] of Object.entries(wingSources)) {
      for (const d of loadWing(src, id).duties ?? []) expect(Object.keys(dutySources)).toContain(d);
    }
  });

  it("Quill's lines load", () => {
    expect(loadQuillLines(quillSource).swift.length).toBeGreaterThan(0);
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

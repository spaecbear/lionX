import { dutySources } from '../../content';
import { loadDuties } from '../content';
import { chooseParams, instantiate, Rng } from '.';

const all = Object.entries(dutySources).flatMap(([id, src]) => loadDuties(src, `${id}.yaml`));
const byId = (id: string) => all.find((t) => t.id === id)!;

/** Every file a template writes, for many seeds, grouped by one parameter. */
function texts(id: string, by: string): Map<string, string[]> {
  const t = byId(id);
  const out = new Map<string, string[]>();
  const rng = new Rng(7);
  for (let i = 0; i < 200; i++) {
    const params = chooseParams(t.params, rng, 1);
    const files = Object.values(instantiate(t, params).setup?.files ?? {}).map((f) =>
      typeof f === 'string' ? f : (f as { content: string }).content,
    );
    const list = out.get(params[by]) ?? [];
    list.push(...files);
    out.set(params[by], list);
  }
  return out;
}

describe('duty books have their own words', () => {
  it.each([
    ['long-scroll', 'scroll', 6],
    ['biggest-book', 'big', 4],
    ['last-entry', 'watcher', 3],
    ['ledger-heading', 'ledgerkind', 3],
    ['grep-the-log', 'observer', 3],
  ])('%s: each %s reads differently', (id, by, count) => {
    const t = texts(id as string, by as string);
    expect(t.size).toBe(count);
    const longest = [...t.values()].map((files) =>
      files.reduce((a, b) => (b.length > a.length ? b : a)),
    );
    // No two variants share more than a few identical lines.
    for (let i = 0; i < longest.length; i++)
      for (let j = i + 1; j < longest.length; j++) {
        const a = new Set(longest[i].split('\n').filter((l) => l.length > 20));
        const shared = longest[j].split('\n').filter((l) => a.has(l));
        expect(shared.length).toBeLessThanOrEqual(3); // a fixed header, at most
      }
    for (const files of t.values()) for (const f of files) expect(f).not.toMatch(/\{\w+\}/);
  });

  it('keeps each puzzle rule in every variant', () => {
    for (const files of texts('grep-the-log', 'observer').values()) {
      const log = files[0].split('\n').filter(Boolean);
      expect(log).toHaveLength(40);
      expect(log.filter((l) => !l.includes('nothing'))).toHaveLength(1);
    }
    for (const files of texts('last-entry', 'watcher').values()) {
      const log = files[0].split('\n').filter(Boolean);
      expect(log).toHaveLength(30);
      expect(log.at(-1)).toMatch(
        /^Entry 30: the [\w-]+ lamp went out at midnight\. Something purred\.$/,
      );
    }
    for (const files of texts('ledger-heading', 'ledgerkind').values())
      expect(files[0].split('\n').slice(0, 3).join('\n')).toMatch(
        /^Ledger of the [\w-]+\nKept by [\w-]+\n/,
      );
    for (const files of texts('biggest-book', 'big').values()) {
      const [big, ...rest] = [...files.slice(0, 3)].sort((a, b) => b.length - a.length);
      for (const r of rest) expect(big.length).toBeGreaterThan(r.length * 5);
    }
  });
});

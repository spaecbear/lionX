import { glossarySource, dutySources, wingSources } from '../../content';
import { loadDuties, loadWing } from '../content';
import { commandsFromHint, explain, loadGlossary, tokenize } from './explain';

const g = loadGlossary(glossarySource);

describe('the solution explainer', () => {
  it('splits words, quotes and symbols', () => {
    expect(tokenize('grep -v lionX north|wc -l')).toEqual([
      'grep',
      '-v',
      'lionX',
      'north',
      '|',
      'wc',
      '-l',
    ]);
    expect(tokenize(`echo "a b" >> ~/x 2>/dev/null`)).toEqual([
      'echo',
      '"a b"',
      '>>',
      '~/x',
      '2>',
      '/dev/null',
    ]);
  });

  it('explains each piece of head -n 3', () => {
    expect(explain('head -n 3 reading-desk-ledger', g)).toEqual([
      ['head', 'reads the first lines of a book'],
      ['-n 3', 'how many lines: 3'],
      ['reading-desk-ledger', 'what the spell works on'],
    ]);
  });

  it('explains pipes, bundled flags, redirections and sudo', () => {
    const p = explain('sudo grep -ri lionx /archive 2> /dev/null | wc -l > ~/count', g);
    expect(p.map((x) => x[0])).toEqual([
      'sudo',
      'grep',
      '-ri',
      'lionx',
      '/archive',
      '2> /dev/null',
      '/dev/null',
      '|',
      'wc',
      '-l',
      '> ~/count',
    ]);
    expect(p[2][1]).toContain('every book in a room');
    expect(p[2][1]).toContain('upper and lower case');
  });

  it('reads the commands out of a final hint', () => {
    expect(commandsFromHint('Type: cd an   then press Tab, then Enter')).toEqual(['cd an']);
    expect(commandsFromHint('Type: ls -a   then: cat .x')).toEqual(['ls -a', 'cat .x']);
  });

  it('knows every spell and flag used in any solution', () => {
    const lines: string[] = [];
    for (const [id, src] of Object.entries(wingSources)) {
      const w = loadWing(src, id);
      for (const s of [...w.lessons.flatMap((l) => l.steps), ...(w.capstone?.steps ?? [])])
        lines.push(...commandsFromHint(s.hints.at(-1) ?? ''));
    }
    for (const [id, src] of Object.entries(dutySources))
      for (const d of loadDuties(src, id))
        lines.push(...d.solution.filter((l) => !/\{(spell|name)\}/.test(l)));
    expect(lines.length).toBeGreaterThan(100);
    const unknown = new Set<string>();
    for (const l of lines)
      for (const [piece, says] of explain(l, g))
        if (says === 'a spell' || says === 'a flag that changes what the spell does')
          unknown.add(piece);
    expect([...unknown]).toEqual([]);
  });
});

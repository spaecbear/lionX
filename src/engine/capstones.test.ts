import { atCapstone } from './test-support';

/**
 * Every capstone solved in at least two different valid ways. Goals check
 * the world, so any sensible route must win.
 */
const solutions: Record<string, string[][]> = {
  'apprentice-cells': [
    ['cd /', 'cd archive', 'cd echo-hall', 'cd atrium', 'ls'],
    ['cd /', 'cd /archive', 'cd /archive/echo-hall', 'cd atrium/', 'ls -a'],
  ],
  'reading-room': [
    [
      'tail /archive/reading-room/archivists-journal',
      'cat /archive/reading-room/back-shelf/.sealed-tome',
    ],
    [
      'cd /archive/reading-room',
      'less archivists-journal',
      'cd back-shelf',
      'ls -a',
      'head -n 50 .sealed-tome',
    ],
  ],
  bindery: [
    [
      'mkdir -p /archive/bindery/shelf/fiction/tales /archive/bindery/shelf/poetry',
      'mv /archive/bindery/loose-pages/tale-* /archive/bindery/shelf/fiction/tales/',
      'mv /archive/bindery/loose-pages/poem-* /archive/bindery/shelf/poetry/',
      'mkdir /archive/bindery/quarantine',
      'mv /archive/bindery/loose-pages/*.lx /archive/bindery/quarantine/',
    ],
    [
      // Copy instead of move, one page at a time, relative paths.
      'cd /archive/bindery',
      'mkdir shelf',
      'mkdir shelf/fiction shelf/poetry',
      'mkdir shelf/fiction/tales',
      'cp loose-pages/tale-of-the-moth loose-pages/tale-of-the-salt loose-pages/tale-of-the-bell shelf/fiction/tales',
      'cp loose-pages/poem-of-rain shelf/poetry/',
      'cp loose-pages/poem-of-ink shelf/poetry/',
      'mkdir quarantine',
      'cd loose-pages',
      'mv fragment-?.lx ../quarantine',
    ],
  ],
  observatory: [
    [
      'grep -rl "Oriel Vane" /archive/observatory/star-charts',
      'mkdir /archive/observatory/true-name',
      'mv /archive/observatory/star-charts/chart-7 /archive/observatory/star-charts/chart-23 /archive/observatory/star-charts/chart-41 /archive/observatory/star-charts/chart-58 /archive/observatory/true-name/',
    ],
    [
      // Search with -n and -w, then copy one at a time from inside the room.
      'cd /archive/observatory/star-charts',
      'grep -nw Vane *',
      'mkdir ../true-name',
      'cp chart-7 ../true-name',
      'cp chart-23 chart-41 ../true-name/',
      'cp chart-58 /archive/observatory/true-name',
    ],
  ],
  aqueducts: [
    [
      'cat /archive/aqueducts/channels/* 2> /dev/null | grep -v lionX | sort > /archive/aqueducts/clean-record',
    ],
    [
      // Channel by channel into a scratch book, then sort it into place.
      'cd /archive/aqueducts/channels',
      'grep -v lionX north > /tmp-clean 2>/dev/null || grep -v lionX north > ~/scratch',
      'grep -v lionX south >> ~/scratch',
      'sort < ~/scratch > /archive/aqueducts/clean-record',
    ],
  ],
};

describe('capstones can be solved more than one way', () => {
  const cases = Object.entries(solutions).flatMap(([wing, ways]) =>
    ways.map((w, i) => [wing, i + 1, w] as const),
  );
  it.each(cases)('%s, way %i', async (wing, _i, lines) => {
    const { runner, type } = atCapstone(wing);
    for (const line of lines) {
      expect(runner.done, `finished early, before: ${line}`).toBe(false);
      await type(line);
    }
    expect(runner.done).toBe(true);
  });

  it('has two ways for every capstone written so far', async () => {
    const { wingChain } = await import('./test-support');
    for (const w of wingChain())
      expect(solutions[w.id]?.length ?? 0, w.id).toBeGreaterThanOrEqual(2);
  });
});

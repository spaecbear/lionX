import { generateCorpus } from './corpus';

describe('generateCorpus', () => {
  const spec = {
    dir: '/x/',
    count: 5,
    lines: 4,
    seed: 1,
    name: 'chart-{#}',
    plant: [{ line: 'NEEDLE', files: [2, 5] }],
  };

  it('makes count files with the given lines, deterministically', () => {
    const a = generateCorpus(spec);
    expect(Object.keys(a)).toEqual([
      '/x/chart-1',
      '/x/chart-2',
      '/x/chart-3',
      '/x/chart-4',
      '/x/chart-5',
    ]);
    expect(a).toEqual(generateCorpus(spec));
    expect(a['/x/chart-1'].split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('plants lines in exactly the named files', () => {
    const a = generateCorpus(spec);
    const withNeedle = Object.entries(a)
      .filter(([, t]) => t.includes('NEEDLE'))
      .map(([p]) => p);
    expect(withNeedle).toEqual(['/x/chart-2', '/x/chart-5']);
  });

  it('accepts numbers given as strings (filled-in placeholders)', () => {
    const a = generateCorpus({
      dir: '/y',
      count: '2' as unknown as number,
      lines: '3' as unknown as number,
      seed: 2,
      plant: [{ line: 'X', files: ['1' as unknown as number] }],
    });
    expect(Object.keys(a)).toEqual(['/y/page-1', '/y/page-2']);
    expect(a['/y/page-1']).toContain('X');
  });
});

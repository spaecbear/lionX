import { buildWorld } from '../../engine/vfs';
import { applyCtrl, normalizeSmartPunctuation } from './input';
import { BAR_PAGES } from './keys';
import { fontSizeFor, layoutFor, MIN_COLUMNS } from './layout';
import { tapInsertion, withSeparator, wordAt } from './tap';

describe('normalizeSmartPunctuation', () => {
  it('turns curly quotes and dashes into ASCII', () => {
    expect(normalizeSmartPunctuation('echo “hi” ‘x’ —help –n…')).toBe(
      'echo "hi" \'x\' --help -n...',
    );
  });
  it('leaves plain text alone', () => {
    expect(normalizeSmartPunctuation('ls -la | head')).toBe('ls -la | head');
  });
});

describe('applyCtrl', () => {
  it.each([
    ['c', '\x03'],
    ['C', '\x03'],
    ['l', '\x0c'],
    ['a', '\x01'],
    ['[', '\x1b'],
    ['?', '\x7f'],
    [' ', '\x00'],
  ])('Ctrl+%j', (key, want) => expect(applyCtrl(key)).toBe(want));
  it.each(['1', '/', '\x1b[A', 'ab'])('no Ctrl meaning for %j', (key) =>
    expect(applyCtrl(key)).toBeNull(),
  );
});

describe('layout', () => {
  it('switches at 600px', () => {
    expect(layoutFor(375)).toBe('narrow');
    expect(layoutFor(599)).toBe('narrow');
    expect(layoutFor(600)).toBe('wide');
  });

  it.each([320, 360, 375, 390, 430])('fits at least 40 columns at %ipx', (w) => {
    const ratio = 0.6;
    const size = fontSizeFor(w, ratio);
    expect(Math.floor(w / (size * ratio))).toBeGreaterThanOrEqual(MIN_COLUMNS);
  });

  it('caps at 16px on big screens and floors at 9px', () => {
    expect(fontSizeFor(1200, 0.6)).toBe(16);
    expect(fontSizeFor(100, 0.6)).toBe(9);
  });
});

describe('wordAt', () => {
  const line = 'notes/  welcome.txt  page\\ one';
  it.each<[number, string | null]>([
    [0, 'notes/'],
    [5, 'notes/'],
    [6, null],
    [10, 'welcome.txt'],
    [99, null],
    [-1, null],
  ])('col %i -> %j', (col, want) => expect(wordAt(line, col)?.word ?? null).toBe(want));
  it('reports the start column', () => expect(wordAt(line, 12)?.start).toBe(8));
});

describe('tapInsertion', () => {
  const vfs = buildWorld({
    user: { name: 'a', groups: ['a'], home: '/home/a' },
    dirs: ['/home/a/notes', '/atrium'],
    files: { '/home/a/welcome.txt': '', '/home/a/notes/page one': '', '/home/a/run': '' },
  });
  it.each<[string, string | null]>([
    ['welcome.txt', 'welcome.txt'],
    ['notes', 'notes/'],
    ['notes/', 'notes/'],
    ['/atrium', '/atrium/'],
    ['run*', 'run'],
    ["'welcome.txt'", 'welcome.txt'],
    ['welcome.txt:', 'welcome.txt'],
    ['(notes),', 'notes/'],
    ['ghost.txt', null],
    ['a@archive:~$', null],
    ['.', null],
    ['..', null],
    ['/', null],
  ])('%j -> %j', (word, want) => expect(tapInsertion(word, vfs)).toBe(want));

  it('escapes names with spaces', () => {
    vfs.chdir('notes');
    expect(tapInsertion('page', vfs)).toBeNull();
    vfs.chdir('~');
  });
});

describe('withSeparator', () => {
  it.each([
    ['', 'x', 'x'],
    ['cat ', 'x', 'x'],
    ['cd notes/', 'x', 'x'],
    ['cat', 'x', ' x'],
  ])('before %j', (before, ins, want) => expect(withSeparator(ins, before)).toBe(want));
});

describe('key bar', () => {
  it('has the required keys on the first page', () => {
    const labels = BAR_PAGES[0].map((k) => k.label);
    for (const l of ['/', '-', '|', '>', '~', '.', '*', 'Tab', 'Ctrl', '↑', '↓']) {
      expect(labels).toContain(l);
    }
  });
  it('has a second page and accessible names for every key', () => {
    expect(BAR_PAGES.length).toBe(2);
    for (const k of BAR_PAGES.flat()) expect(k.aria.length).toBeGreaterThan(0);
  });
});

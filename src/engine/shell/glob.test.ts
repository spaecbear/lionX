import { Vfs } from '../vfs';
import { expandGlob, hasGlobChars, segmentToRegExp, unescapeGlob } from './glob';

function fs() {
  const v = new Vfs();
  v.mkdir('/w/shelf/fiction', { parents: true });
  v.mkdir('/w/shelf/poetry');
  for (const f of [
    'a.txt',
    'b.txt',
    'ab.md',
    '.hidden.txt',
    '[x]',
    'shelf/fiction/tale1',
    'shelf/fiction/tale2',
    'shelf/poetry/ode',
  ]) {
    v.createFile(`/w/${f}`);
  }
  v.chdir('/w');
  return v;
}

describe('glob helpers', () => {
  it('hasGlobChars respects escapes and unclosed brackets', () => {
    expect(hasGlobChars('*.txt')).toBe(true);
    expect(hasGlobChars('a?')).toBe(true);
    expect(hasGlobChars('[ab]')).toBe(true);
    expect(hasGlobChars('\\*.txt')).toBe(false);
    expect(hasGlobChars('[ab')).toBe(false);
    expect(hasGlobChars('plain')).toBe(false);
  });

  it('unescapeGlob', () => {
    expect(unescapeGlob('\\*a\\\\')).toBe('*a\\');
  });

  it.each([
    ['*.txt', 'a.txt', true],
    ['*.txt', 'a.md', false],
    ['?.txt', 'ab.txt', false],
    ['[ab].txt', 'b.txt', true],
    ['[!ab].txt', 'c.txt', true],
    ['[^ab].txt', 'a.txt', false],
    ['[a-c]*', 'b', true],
    ['[]]', ']', true],
    ['a.b', 'axb', false],
    ['\\*', '*', true],
    ['[', '[', true],
    ['(x)+', '(x)+', true],
  ])('%j matches %j: %s', (pat, name, want) => {
    expect(segmentToRegExp(pat).test(name)).toBe(want);
  });
});

describe('expandGlob', () => {
  it.each<[string, string[]]>([
    ['*.txt', ['a.txt', 'b.txt']],
    ['*', ['[x]', 'a.txt', 'ab.md', 'b.txt', 'shelf']],
    ['.*', ['.hidden.txt']],
    ['?.txt', ['a.txt', 'b.txt']],
    ['a*', ['a.txt', 'ab.md']],
    ['shelf/*/tale?', ['shelf/fiction/tale1', 'shelf/fiction/tale2']],
    ['shelf/*/', ['shelf/fiction/', 'shelf/poetry/']],
    ['*/', ['shelf/']],
    ['/w/shelf/p*', ['/w/shelf/poetry']],
    ['/w/*/fiction', ['/w/shelf/fiction']],
    ['nothing*', []],
    ['missing/*', []],
    ['a.txt/*', []],
    ['\\*.txt', []],
    ['//w//*.md', ['/w/ab.md']],
  ])('%j', (pat, want) => {
    expect(expandGlob(pat, fs())).toEqual(want);
  });

  it('skips unreadable directories', () => {
    const v = fs();
    v.chmod('/w/shelf/poetry', 0);
    v.credentials = { user: 'apprentice', groups: [] };
    expect(expandGlob('shelf/*/*', v)).toEqual(['shelf/fiction/tale1', 'shelf/fiction/tale2']);
  });
});

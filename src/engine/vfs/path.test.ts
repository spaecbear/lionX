import {
  basename,
  dirname,
  expandTilde,
  isHidden,
  isWithin,
  joinPath,
  resolvePath,
  splitPath,
} from './path';

describe('splitPath', () => {
  it.each([
    ['/', []],
    ['', []],
    ['a/b', ['a', 'b']],
    ['//a///b//', ['a', 'b']],
  ])('%j -> %j', (p, out) => expect(splitPath(p)).toEqual(out));
});

describe('expandTilde', () => {
  it('expands ~ and ~/', () => {
    expect(expandTilde('~', '/home/a')).toBe('/home/a');
    expect(expandTilde('~/x', '/home/a')).toBe('/home/a/x');
  });
  it('leaves ~user and mid-path tildes alone', () => {
    expect(expandTilde('~bob', '/home/a')).toBe('~bob');
    expect(expandTilde('a/~', '/home/a')).toBe('a/~');
  });
});

describe('resolvePath', () => {
  const H = '/home/apprentice';
  it.each([
    ['/', '/x', '/'],
    ['..', '/', '/'],
    ['../../..', '/a', '/'],
    ['/..', '/a', '/'],
    ['.', '/a/b', '/a/b'],
    ['', '/a/b', '/a/b'],
    ['c', '/a/b', '/a/b/c'],
    ['c/', '/a/b', '/a/b/c'],
    ['c//d///', '/a', '/a/c/d'],
    ['../c', '/a/b', '/a/c'],
    ['./c/./d/..', '/a', '/a/c'],
    ['~', '/', H],
    ['~/', '/', H],
    ['~/../x', '/', '/home/x'],
    ['//abs//path', '/x', '/abs/path'],
  ])('resolve(%j, cwd=%j) = %j', (p, cwd, out) => expect(resolvePath(p, cwd, H)).toBe(out));
});

describe('dirname / basename / joinPath / isWithin / isHidden', () => {
  it('dirname', () => {
    expect(dirname('/')).toBe('/');
    expect(dirname('/a')).toBe('/');
    expect(dirname('/a/b')).toBe('/a');
  });
  it('basename', () => {
    expect(basename('/')).toBe('/');
    expect(basename('/a/b/')).toBe('b');
    expect(basename('c')).toBe('c');
  });
  it('joinPath', () => {
    expect(joinPath('/a/', '/b', 'c/')).toBe('/a/b/c');
    expect(joinPath('a', 'b')).toBe('a/b');
  });
  it('isWithin', () => {
    expect(isWithin('/a/b', '/a')).toBe(true);
    expect(isWithin('/a', '/a')).toBe(true);
    expect(isWithin('/ab', '/a')).toBe(false);
    expect(isWithin('/x', '/')).toBe(true);
  });
  it('isHidden', () => {
    expect(isHidden('.journal')).toBe(true);
    expect(isHidden('journal')).toBe(false);
  });
});

import { Vfs, type VfsSnapshot } from './vfs';
import { VfsError, isVfsError, type ErrnoCode } from './errors';

const APPRENTICE = { user: 'apprentice', groups: ['apprentice', 'scribes'] };
const ROOT = { user: 'root', groups: ['root'] };

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (n = 1) => (t += n) };
}

function expectErr(fn: () => unknown, code: ErrnoCode, path?: string) {
  try {
    fn();
  } catch (e) {
    expect(isVfsError(e, code), `expected ${code}, got ${String(e)}`).toBe(true);
    if (path !== undefined) expect((e as VfsError).path).toBe(path);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}

/** A small Archive: root sets it up, then hands the terminal to the apprentice. */
function archive() {
  const c = clock();
  const fs = new Vfs({ now: c.now, home: '/home/apprentice' });
  fs.mkdir('/home/apprentice', { parents: true });
  fs.chown('/home/apprentice', 'apprentice', 'apprentice');
  fs.mkdir('/atrium');
  fs.writeFile('/atrium/welcome.txt', 'Welcome, apprentice.\n');
  fs.mkdir('/vault');
  fs.chmod('/vault', 0o700);
  fs.writeFile('/vault/root-seal', 'lionX holds this.\n');
  fs.mkdir('/scriptorium');
  fs.chown('/scriptorium', 'root', 'scribes');
  fs.chmod('/scriptorium', 0o770);
  fs.credentials = APPRENTICE;
  fs.chdir('~');
  return { fs, c };
}

describe('VfsError', () => {
  it('carries code, path, and strerror text', () => {
    const e = new VfsError('ENOENT', 'nope');
    expect(e.message).toBe('nope: No such file or directory');
    expect(e.reason).toBe('No such file or directory');
    expect(isVfsError(e)).toBe(true);
    expect(isVfsError(e, 'EACCES')).toBe(false);
    expect(isVfsError(new Error('x'))).toBe(false);
  });
});

describe('construction and session', () => {
  it('starts with an empty root owned by root at cwd /', () => {
    const fs = new Vfs();
    expect(fs.cwd).toBe('/');
    expect(fs.isRoot).toBe(true);
    expect(fs.readdir('/')).toEqual([]);
    expect(fs.stat('/')).toMatchObject({ type: 'dir', owner: 'root', mode: 0o755, name: '/' });
  });

  it('accepts an initial cwd', () => {
    expect(new Vfs({ cwd: '/a/../b' }).cwd).toBe('/b');
  });

  it('chdir handles relative, absolute, ~, ., .., and trailing slashes', () => {
    const { fs } = archive();
    expect(fs.cwd).toBe('/home/apprentice');
    expect(fs.chdir('..')).toBe('/home');
    expect(fs.chdir('../atrium/')).toBe('/atrium');
    expect(fs.chdir('.')).toBe('/atrium');
    expect(fs.chdir('//home//apprentice//')).toBe('/home/apprentice');
    expect(fs.chdir('~/..')).toBe('/home');
  });

  it('cd .. at / stays at /', () => {
    const { fs } = archive();
    fs.chdir('/');
    expect(fs.chdir('..')).toBe('/');
    expect(fs.chdir('../../..')).toBe('/');
  });

  it('chdir errors: ENOENT, ENOTDIR, EACCES; cwd unchanged', () => {
    const { fs } = archive();
    expectErr(() => fs.chdir('nowhere'), 'ENOENT', 'nowhere');
    expectErr(() => fs.chdir('/atrium/welcome.txt'), 'ENOTDIR');
    expectErr(() => fs.chdir('/vault'), 'EACCES', '/vault');
    expect(fs.cwd).toBe('/home/apprentice');
  });

  it('resolve is purely lexical', () => {
    const { fs } = archive();
    expect(fs.resolve('ghost/../x')).toBe('/home/apprentice/x');
  });
});

describe('inspection', () => {
  it('exists / isDir / isFile', () => {
    const { fs } = archive();
    expect(fs.exists('/atrium')).toBe(true);
    expect(fs.exists('/missing')).toBe(false);
    expect(fs.exists('/vault/root-seal')).toBe(false); // hidden behind a ward
    expect(fs.isDir('/atrium')).toBe(true);
    expect(fs.isDir('/atrium/welcome.txt')).toBe(false);
    expect(fs.isDir('/missing')).toBe(false);
    expect(fs.isFile('/atrium/welcome.txt')).toBe(true);
    expect(fs.isFile('/atrium')).toBe(false);
    expect(fs.isFile('/missing')).toBe(false);
  });

  it('stat reports size in bytes, nlink, and metadata', () => {
    const { fs } = archive();
    fs.writeFile('~/rune', 'é'); // 2 bytes in UTF-8
    const s = fs.stat('~/rune');
    expect(s).toMatchObject({
      name: 'rune',
      path: '/home/apprentice/rune',
      type: 'file',
      size: 2,
      mode: 0o644,
      owner: 'apprentice',
      group: 'apprentice',
      nlink: 1,
    });
    fs.mkdir('~/a');
    fs.mkdir('~/b');
    expect(fs.stat('~').nlink).toBe(4);
    expect(fs.stat('~').size).toBe(4096);
  });

  it('a trailing slash on a file is ENOTDIR', () => {
    const { fs } = archive();
    expectErr(() => fs.stat('/atrium/welcome.txt/'), 'ENOTDIR');
    expectErr(() => fs.readFile('/atrium/welcome.txt/.'), 'ENOTDIR');
    expectErr(() => fs.stat('/atrium/welcome.txt/x'), 'ENOTDIR');
  });

  it('readdir sorts byte-wise and includes hidden entries', () => {
    const { fs } = archive();
    for (const n of ['b', 'A', '.sealed', 'a']) fs.createFile(`~/${n}`);
    expect(fs.readdir('~')).toEqual(['.sealed', 'A', 'a', 'b']);
  });

  it('readdir/list errors', () => {
    const { fs } = archive();
    expectErr(() => fs.readdir('/atrium/welcome.txt'), 'ENOTDIR');
    expectErr(() => fs.readdir('/missing'), 'ENOENT');
    expectErr(() => fs.readdir('/vault'), 'EACCES');
    expectErr(() => fs.list('/vault'), 'EACCES');
  });

  it('list returns stats with full paths, also at /', () => {
    const { fs } = archive();
    expect(fs.list('/').map((s) => s.path)).toEqual(['/atrium', '/home', '/scriptorium', '/vault']);
    expect(fs.list('/atrium')[0]).toMatchObject({ name: 'welcome.txt', type: 'file' });
  });

  it('list needs search permission too (r-- dir)', () => {
    const { fs } = archive();
    fs.mkdir('~/peek');
    fs.chmod('~/peek', 0o400);
    expect(fs.readdir('~/peek')).toEqual([]);
    expectErr(() => fs.list('~/peek'), 'EACCES');
  });

  it('walk is pre-order, sorted, and reports unreadable dirs', () => {
    const fs = new Vfs();
    fs.mkdir('/w/b/deep', { parents: true });
    fs.createFile('/w/a');
    fs.createFile('/w/b/deep/x');
    fs.mkdir('/w/locked');
    fs.chmod('/w/locked', 0);
    fs.credentials = APPRENTICE;
    const errors: string[] = [];
    const paths = [...fs.walk('/w', (e) => errors.push(e.path))].map((s) => s.path);
    expect(paths).toEqual(['/w', '/w/a', '/w/b', '/w/b/deep', '/w/b/deep/x', '/w/locked']);
    expect(errors).toEqual(['/w/locked']);
    expect([...fs.walk('/w/a')].map((s) => s.path)).toEqual(['/w/a']);
  });

  it('access reports r/w/x for the current user', () => {
    const { fs } = archive();
    expect(fs.access('/atrium/welcome.txt', 'r')).toBe(true);
    expect(fs.access('/atrium/welcome.txt', 'w')).toBe(false);
    expect(fs.access('/atrium', 'x')).toBe(true);
    expect(fs.access('/missing', 'r')).toBe(false);
  });
});

describe('reading and writing', () => {
  it('writeFile creates (mode 666 & ~umask) and truncates', () => {
    const { fs } = archive();
    fs.writeFile('page', 'one');
    expect(fs.stat('page').mode).toBe(0o644);
    fs.writeFile('page', 'two');
    expect(fs.readFile('page')).toBe('two');
  });

  it('respects a custom umask', () => {
    const fs = new Vfs({ umask: 0o077 });
    fs.writeFile('/f', '');
    fs.mkdir('/d');
    expect(fs.stat('/f').mode).toBe(0o600);
    expect(fs.stat('/d').mode).toBe(0o700);
  });

  it('appendFile appends and creates', () => {
    const { fs } = archive();
    fs.appendFile('log', 'a\n');
    fs.appendFile('log', 'b\n');
    expect(fs.readFile('log')).toBe('a\nb\n');
  });

  it('write errors', () => {
    const { fs } = archive();
    expectErr(() => fs.writeFile('/atrium', 'x'), 'EISDIR');
    expectErr(() => fs.writeFile('newdir/', 'x'), 'EISDIR');
    expectErr(() => fs.writeFile('/atrium/welcome.txt', 'x'), 'EACCES');
    expectErr(() => fs.writeFile('/atrium/new', 'x'), 'EACCES', '/atrium/new');
    expectErr(() => fs.writeFile('/missing/new', 'x'), 'ENOENT', '/missing/new');
    expectErr(() => fs.writeFile('/atrium/welcome.txt/x', 'x'), 'ENOTDIR');
    expectErr(() => fs.appendFile('/vault/root-seal', 'x'), 'EACCES');
  });

  it('readFile errors and atime update', () => {
    const { fs, c } = archive();
    expectErr(() => fs.readFile('/atrium'), 'EISDIR');
    expectErr(() => fs.readFile('/nope'), 'ENOENT');
    expectErr(() => fs.readFile('/vault/root-seal'), 'EACCES');
    fs.writeFile('secret', 'x');
    fs.chmod('secret', 0o200);
    expectErr(() => fs.readFile('secret'), 'EACCES');
    c.tick(5);
    expect(fs.readFile('/atrium/welcome.txt')).toBe('Welcome, apprentice.\n');
    expect(fs.stat('/atrium/welcome.txt').atime).toBe(1005);
  });

  it('createFile is exclusive', () => {
    const { fs } = archive();
    fs.createFile('scroll', 'text');
    expect(fs.readFile('scroll')).toBe('text');
    expectErr(() => fs.createFile('scroll'), 'EEXIST');
    expectErr(() => fs.createFile('/'), 'EEXIST');
    expectErr(() => fs.createFile('/atrium/x'), 'EACCES');
  });

  it('touch creates or bumps timestamps; needs ownership or write', () => {
    const { fs, c } = archive();
    fs.touch('t');
    expect(fs.readFile('t')).toBe('');
    c.tick(10);
    fs.touch('t');
    expect(fs.stat('t').mtime).toBe(1010);
    expectErr(() => fs.touch('/atrium/welcome.txt'), 'EACCES');
    expectErr(() => fs.touch('/nope/x'), 'ENOENT');
  });

  it('touch by group member with write works on files they do not own', () => {
    const { fs } = archive();
    fs.credentials = ROOT;
    fs.writeFile('/scriptorium/shared', '');
    fs.chown('/scriptorium/shared', 'root', 'scribes');
    fs.chmod('/scriptorium/shared', 0o664);
    fs.credentials = APPRENTICE;
    fs.touch('/scriptorium/shared');
  });

  it('parent mtime changes when entries are added', () => {
    const { fs, c } = archive();
    c.tick(7);
    fs.createFile('x');
    expect(fs.stat('~').mtime).toBe(1007);
  });
});

describe('mkdir', () => {
  it('creates a directory with 755', () => {
    const { fs } = archive();
    fs.mkdir('shelf');
    expect(fs.stat('shelf')).toMatchObject({ type: 'dir', mode: 0o755, owner: 'apprentice' });
  });

  it('explicit mode is masked by umask', () => {
    const { fs } = archive();
    fs.mkdir('m', { mode: 0o777 });
    expect(fs.stat('m').mode).toBe(0o755);
  });

  it('errors without parents', () => {
    const { fs } = archive();
    fs.mkdir('shelf');
    expectErr(() => fs.mkdir('shelf'), 'EEXIST');
    expectErr(() => fs.mkdir('a/b'), 'ENOENT', 'a/b');
    expectErr(() => fs.mkdir('/atrium/x'), 'EACCES');
    expectErr(() => fs.mkdir('/'), 'EEXIST');
  });

  it('-p creates the whole chain and tolerates existing dirs', () => {
    const { fs } = archive();
    fs.mkdir('shelf/fiction/tales/', { parents: true });
    expect(fs.isDir('~/shelf/fiction/tales')).toBe(true);
    fs.mkdir('shelf/fiction', { parents: true });
    fs.mkdir('/', { parents: true });
  });

  it('-p errors: file in the way, permissions', () => {
    const { fs } = archive();
    fs.createFile('f');
    expectErr(() => fs.mkdir('f', { parents: true }), 'EEXIST');
    expectErr(() => fs.mkdir('f/x', { parents: true }), 'ENOTDIR');
    expectErr(() => fs.mkdir('/atrium/a/b', { parents: true }), 'EACCES');
    expectErr(() => fs.mkdir('/vault/a', { parents: true }), 'EACCES');
  });
});

describe('removal', () => {
  it('unlink removes files only', () => {
    const { fs } = archive();
    fs.createFile('p');
    fs.unlink('p');
    expect(fs.exists('p')).toBe(false);
    expectErr(() => fs.unlink('p'), 'ENOENT');
    expectErr(() => fs.unlink('/atrium'), 'EISDIR');
    expectErr(() => fs.unlink('/atrium/welcome.txt'), 'EACCES');
  });

  it('removing needs write on the parent, not on the file', () => {
    const { fs } = archive();
    fs.createFile('ro');
    fs.chmod('ro', 0o444);
    fs.unlink('ro');
    expect(fs.exists('ro')).toBe(false);
  });

  it('rmdir', () => {
    const { fs } = archive();
    fs.mkdir('d/e', { parents: true });
    expectErr(() => fs.rmdir('d'), 'ENOTEMPTY');
    fs.rmdir('d/e');
    fs.rmdir('d/');
    expect(fs.exists('d')).toBe(false);
    fs.createFile('f');
    expectErr(() => fs.rmdir('f'), 'ENOTDIR');
    expectErr(() => fs.rmdir('/'), 'EBUSY');
    expectErr(() => fs.rmdir('/missing'), 'ENOENT');
    fs.credentials = ROOT;
    fs.mkdir('/empty');
    fs.credentials = APPRENTICE;
    expectErr(() => fs.rmdir('/empty'), 'EACCES');
  });

  it('rmdir refuses the cwd or an ancestor of it', () => {
    const { fs } = archive();
    fs.mkdir('here');
    fs.chdir('here');
    expectErr(() => fs.rmdir('.'), 'EBUSY');
  });

  it('remove: files, -r trees, and errors', () => {
    const { fs } = archive();
    fs.mkdir('t/a/b', { parents: true });
    fs.writeFile('t/a/b/page', 'x');
    fs.writeFile('t/top', 'y');
    expectErr(() => fs.remove('t'), 'EISDIR');
    fs.remove('t/top');
    fs.remove('t', { recursive: true });
    expect(fs.exists('t')).toBe(false);
    expectErr(() => fs.remove('t'), 'ENOENT');
    expectErr(() => fs.remove('/', { recursive: true }), 'EPERM');
    expectErr(() => fs.remove('~', { recursive: true }), 'EBUSY');
    expectErr(() => fs.remove('/atrium', { recursive: true }), 'EACCES');
  });

  it('remove -r is all-or-nothing when a subdir is protected', () => {
    const { fs } = archive();
    fs.mkdir('t/locked', { parents: true });
    fs.createFile('t/a');
    fs.createFile('t/locked/b');
    fs.chmod('t/locked', 0o555);
    expectErr(() => fs.remove('t', { recursive: true }), 'EACCES', '/home/apprentice/t/locked');
    expect(fs.exists('t/a')).toBe(true);
    expect(fs.exists('t/locked/b')).toBe(true);
  });

  it('remove -r of an empty unreadable dir works (like rm -r)', () => {
    const { fs } = archive();
    fs.mkdir('e');
    fs.chmod('e', 0);
    fs.remove('e', { recursive: true });
    expect(fs.exists('e')).toBe(false);
  });
});

describe('move', () => {
  it('renames files and directories', () => {
    const { fs } = archive();
    fs.writeFile('a', '1');
    fs.move('a', 'b');
    expect(fs.readFile('b')).toBe('1');
    expect(fs.exists('a')).toBe(false);
    fs.mkdir('d');
    fs.createFile('d/x');
    fs.move('d', 'e/');
    expect(fs.isFile('e/x')).toBe(true);
  });

  it('replaces an existing file and an empty directory', () => {
    const { fs } = archive();
    fs.writeFile('a', 'new');
    fs.writeFile('b', 'old');
    fs.move('a', 'b');
    expect(fs.readFile('b')).toBe('new');
    fs.mkdir('d1');
    fs.createFile('d1/keep');
    fs.mkdir('d2');
    fs.move('d1', 'd2');
    expect(fs.isFile('d2/keep')).toBe(true);
  });

  it('same path is a no-op', () => {
    const { fs } = archive();
    fs.writeFile('a', '1');
    fs.move('a', './a');
    expect(fs.readFile('a')).toBe('1');
  });

  it('errors', () => {
    const { fs } = archive();
    fs.createFile('f');
    fs.mkdir('d/sub', { parents: true });
    fs.mkdir('full');
    fs.createFile('full/x');
    expectErr(() => fs.move('missing', 'x'), 'ENOENT', 'missing');
    expectErr(() => fs.move('f', 'nowhere/f'), 'ENOENT', 'nowhere/f');
    expectErr(() => fs.move('f', 'd'), 'EISDIR');
    expectErr(() => fs.move('d', 'f'), 'ENOTDIR');
    expectErr(() => fs.move('d', 'full'), 'ENOTEMPTY');
    expectErr(() => fs.move('d', 'd/sub/d'), 'EINVAL');
    expectErr(() => fs.move('f', '/atrium/f'), 'EACCES');
    expectErr(() => fs.move('/atrium/welcome.txt', 'w'), 'EACCES');
    expectErr(() => fs.move('/', '/x'), 'EBUSY');
    expectErr(() => fs.move('~', '/tmp-home'), 'EBUSY');
  });

  it('updates ctime', () => {
    const { fs, c } = archive();
    fs.createFile('a');
    c.tick(3);
    fs.move('a', 'b');
    expect(fs.stat('b').ctime).toBe(1003);
  });
});

describe('copy', () => {
  it('copies a file; new copy is owned by the caller', () => {
    const { fs } = archive();
    fs.copy('/atrium/welcome.txt', 'w');
    expect(fs.readFile('w')).toBe('Welcome, apprentice.\n');
    expect(fs.stat('w')).toMatchObject({ owner: 'apprentice', mode: 0o644 });
    expect(fs.readFile('/atrium/welcome.txt')).toBe('Welcome, apprentice.\n');
  });

  it('overwrites an existing file in place, keeping its mode', () => {
    const { fs } = archive();
    fs.writeFile('dst', 'old');
    fs.chmod('dst', 0o600);
    fs.copy('/atrium/welcome.txt', 'dst');
    expect(fs.readFile('dst')).toBe('Welcome, apprentice.\n');
    expect(fs.stat('dst').mode).toBe(0o600);
  });

  it('copies trees with -r, independently of the source', () => {
    const { fs } = archive();
    fs.mkdir('src/a', { parents: true });
    fs.writeFile('src/a/p', '1');
    fs.copy('src', 'dst', { recursive: true });
    fs.writeFile('src/a/p', 'changed');
    expect(fs.readFile('dst/a/p')).toBe('1');
  });

  it('merges a directory into an existing one', () => {
    const { fs } = archive();
    fs.mkdir('src/a', { parents: true });
    fs.writeFile('src/a/p', 'new');
    fs.writeFile('src/q', 'q');
    fs.mkdir('dst/a', { parents: true });
    fs.writeFile('dst/a/p', 'old');
    fs.writeFile('dst/keep', 'k');
    fs.copy('src', 'dst', { recursive: true });
    expect(fs.readFile('dst/a/p')).toBe('new');
    expect(fs.readFile('dst/q')).toBe('q');
    expect(fs.readFile('dst/keep')).toBe('k');
  });

  it('merge conflicts between file and dir', () => {
    const { fs } = archive();
    fs.mkdir('s1/x', { parents: true });
    fs.mkdir('d1');
    fs.createFile('d1/x');
    expectErr(() => fs.copy('s1', 'd1', { recursive: true }), 'ENOTDIR');
    fs.mkdir('s2');
    fs.createFile('s2/x');
    fs.mkdir('d2/x', { parents: true });
    expectErr(() => fs.copy('s2', 'd2', { recursive: true }), 'EISDIR');
  });

  it('errors', () => {
    const { fs } = archive();
    fs.mkdir('d');
    fs.createFile('f');
    expectErr(() => fs.copy('d', 'e'), 'EISDIR', 'd');
    expectErr(() => fs.copy('f', 'f'), 'EINVAL');
    expectErr(() => fs.copy('d', 'd/inner', { recursive: true }), 'EINVAL');
    expectErr(() => fs.copy('f', 'd'), 'EISDIR');
    expectErr(() => fs.copy('d', 'f', { recursive: true }), 'ENOTDIR');
    expectErr(() => fs.copy('missing', 'x'), 'ENOENT');
    expectErr(() => fs.copy('f', '/atrium/f'), 'EACCES');
    expectErr(() => fs.copy('f', '/atrium/welcome.txt'), 'EACCES');
    expectErr(() => fs.copy('/vault', 'v', { recursive: true }), 'EACCES');
  });

  it('copy -r fails before writing if any source is unreadable', () => {
    const { fs } = archive();
    fs.mkdir('s');
    fs.createFile('s/ok');
    fs.createFile('s/sealed');
    fs.chmod('s/sealed', 0);
    expectErr(() => fs.copy('s', 'd', { recursive: true }), 'EACCES');
    expect(fs.exists('d')).toBe(false);
  });
});

describe('chmod and chown', () => {
  it('owner can chmod; others get EPERM; extra bits are masked', () => {
    const { fs } = archive();
    fs.createFile('f');
    fs.chmod('f', 0o17640);
    expect(fs.stat('f').mode).toBe(0o7640);
    expectErr(() => fs.chmod('/atrium', 0o777), 'EPERM');
    expectErr(() => fs.chmod('/nope', 0o777), 'ENOENT');
  });

  it('only root can chown, and either part is optional', () => {
    const { fs } = archive();
    fs.createFile('f');
    expectErr(() => fs.chown('f', 'archivist'), 'EPERM');
    fs.credentials = ROOT;
    fs.chown('/home/apprentice/f', 'archivist');
    expect(fs.stat('/home/apprentice/f')).toMatchObject({
      owner: 'archivist',
      group: 'apprentice',
    });
    fs.chown('/home/apprentice/f', undefined, 'scribes');
    expect(fs.stat('/home/apprentice/f').group).toBe('scribes');
  });
});

describe('permission model', () => {
  it('group bits apply to group members, other bits to everyone else', () => {
    const { fs } = archive();
    fs.writeFile('/scriptorium/notes', 'shared');
    expect(fs.readFile('/scriptorium/notes')).toBe('shared');
    fs.credentials = { user: 'wanderer', groups: ['wanderer'] };
    expectErr(() => fs.readdir('/scriptorium'), 'EACCES');
    expectErr(() => fs.readFile('/scriptorium/notes'), 'EACCES');
  });

  it('owner bits win over group bits even when more restrictive', () => {
    const { fs } = archive();
    fs.writeFile('mine', 'x');
    fs.chmod('mine', 0o044);
    expectErr(() => fs.readFile('mine'), 'EACCES');
  });

  it('search (x) on every ancestor is required', () => {
    const { fs } = archive();
    fs.mkdir('outer/inner', { parents: true });
    fs.writeFile('outer/inner/page', 'p');
    fs.chmod('outer', 0o644);
    expectErr(() => fs.readFile('outer/inner/page'), 'EACCES');
    expectErr(() => fs.stat('outer/inner'), 'EACCES');
    expect(fs.isDir('outer')).toBe(true);
  });

  it('root bypasses r/w but needs an x bit to execute files', () => {
    const { fs } = archive();
    fs.credentials = ROOT;
    expect(fs.readFile('/vault/root-seal')).toBe('lionX holds this.\n');
    fs.writeFile('/vault/root-seal', 'freed');
    fs.chmod('/vault/root-seal', 0);
    expect(fs.readFile('/vault/root-seal')).toBe('freed');
    expect(fs.access('/vault/root-seal', 'x')).toBe(false);
    fs.chmod('/vault/root-seal', 0o100);
    expect(fs.access('/vault/root-seal', 'x')).toBe(true);
    expect(fs.access('/vault', 'x')).toBe(true);
  });

  it('a user with no matching group falls back to the primary group name', () => {
    const fs = new Vfs({ credentials: { user: 'lionx', groups: [] } });
    // Only root can write /, so build as root then hand over.
    fs.credentials = ROOT;
    fs.mkdir('/den');
    fs.chown('/den', 'lionx');
    fs.credentials = { user: 'lionx', groups: [] };
    fs.createFile('/den/claw');
    expect(fs.stat('/den/claw').group).toBe('lionx');
  });
});

describe('serialization', () => {
  it('round-trips the tree, cwd, credentials, and umask', () => {
    const { fs } = archive();
    fs.mkdir('shelf/fiction', { parents: true });
    fs.writeFile('shelf/.sealed', 'tome');
    fs.chdir('shelf');
    const json = JSON.stringify(fs);
    const back = Vfs.load(json);
    expect(back.serialize()).toEqual(fs.serialize());
    expect(back.cwd).toBe('/home/apprentice/shelf');
    expect(back.credentials).toEqual(APPRENTICE);
    expect(back.readFile('.sealed')).toBe('tome');
    expectErr(() => back.readFile('/vault/root-seal'), 'EACCES');
  });

  it('snapshot is a deep copy', () => {
    const { fs } = archive();
    const snap = fs.serialize();
    fs.writeFile('later', 'x');
    expect(Vfs.load(snap).exists('/home/apprentice/later')).toBe(false);
  });

  it('accepts object snapshots and a clock', () => {
    const { fs } = archive();
    const back = Vfs.load(fs.serialize(), { now: () => 42 });
    back.createFile('t');
    expect(back.stat('t').mtime).toBe(42);
  });

  it('falls back to / if the saved cwd no longer exists', () => {
    const { fs } = archive();
    const snap = { ...fs.serialize(), cwd: '/gone' };
    expect(Vfs.load(snap).cwd).toBe('/');
  });

  it('handles awkward names like __proto__', () => {
    const fs = new Vfs();
    fs.createFile('/__proto__', 'x');
    fs.createFile('/constructor', 'y');
    const back = Vfs.load(JSON.stringify(fs));
    expect(back.readdir('/')).toEqual(['__proto__', 'constructor']);
    expect(back.readFile('/__proto__')).toBe('x');
  });

  it('rejects bad snapshots', () => {
    const good = new Vfs().serialize();
    expect(() => Vfs.load({ ...good, version: 99 })).toThrow(/version/);
    const fileRoot = { ...good, root: { ...good.root, type: 'file', content: '' } };
    expect(() => Vfs.load(fileRoot as VfsSnapshot)).toThrow(/root/);
    const badName = structuredClone(good);
    (badName.root as { children: Record<string, unknown> }).children['a/b'] = {
      ...good.root,
      children: {},
    };
    expect(() => Vfs.load(badName)).toThrow(/Invalid entry/);
    const badType = structuredClone(good);
    (badType.root as { children: Record<string, unknown> }).children['x'] = { type: 'link' };
    expect(() => Vfs.load(badType)).toThrow(/Unknown node type/);
  });
});

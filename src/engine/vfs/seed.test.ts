import { buildWorld } from './seed';

describe('buildWorld', () => {
  const world = () =>
    buildWorld(
      {
        user: { name: 'apprentice', groups: ['apprentice', 'scribes'], home: '/home/apprentice' },
        dirs: ['/atrium/east', { path: '/vault', mode: '700', owner: 'lionx' }],
        files: {
          '/home/apprentice/note': 'hi\n',
          '/vault/seal': { content: 'x', owner: 'lionx', mode: 0o600 },
          '/deep/auto/parent': 'p',
        },
      },
      { now: () => 5 },
    );

  it('creates dirs, files, and the player home, then hands over the terminal', () => {
    const fs = world();
    expect(fs.cwd).toBe('/home/apprentice');
    expect(fs.credentials.user).toBe('apprentice');
    expect(fs.isDir('/atrium/east')).toBe(true);
    expect(fs.readFile('/deep/auto/parent')).toBe('p');
    expect(fs.stat('~')).toMatchObject({ owner: 'apprentice', group: 'apprentice' });
    expect(fs.stat('~/note')).toMatchObject({ owner: 'apprentice', group: 'apprentice', mtime: 5 });
    expect(fs.stat('/atrium')).toMatchObject({ owner: 'root', mode: 0o755 });
  });

  it('applies modes and owners, locking directories after filling them', () => {
    const fs = world();
    expect(fs.stat('/vault')).toMatchObject({ owner: 'lionx', mode: 0o700 });
    expect(fs.exists('/vault/seal')).toBe(false); // apprentice cannot see past the ward
    expect(fs.access('/vault', 'x')).toBe(false);
  });

  it('respects an explicit cwd', () => {
    const fs = buildWorld({
      user: { name: 'a', groups: [], home: '/home/a' },
      dirs: ['/atrium'],
      cwd: '/atrium',
    });
    expect(fs.cwd).toBe('/atrium');
    expect(fs.stat('/home/a').group).toBe('a');
  });
});

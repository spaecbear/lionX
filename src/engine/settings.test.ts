import { createRegistry } from './commands';
import { Shell } from './shell';
import { buildWorld } from './vfs';
import { createSettingsCommand, DEFAULT_SETTINGS, type Settings } from './settings';

function setup(available: string[]) {
  let current: Settings = { ...DEFAULT_SETTINGS };
  const registry = createRegistry().register(
    createSettingsCommand({
      get: () => current,
      set: (n) => (current = n),
      themes: () =>
        ['candlelit', 'electric-blue', 'parchment', 'high-contrast'].map((name) => ({
          name,
          available: available.includes(name),
        })),
    }),
  );
  let out = '';
  let err = '';
  const shell = new Shell({
    vfs: buildWorld({ user: { name: 'a', groups: ['a'], home: '/home/a' } }),
    registry,
    terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
  });
  const run = async (l: string) => {
    out = '';
    err = '';
    const status = await shell.run(l);
    return { out, err, status };
  };
  return { run, get: () => current };
}

describe('settings', () => {
  it('shows preferences, marking unearned themes', async () => {
    const g = setup(['candlelit', 'high-contrast']);
    const r = await g.run('settings');
    expect(r.out).toContain('theme:   candlelit');
    expect(r.out).toContain('* candlelit');
    expect(r.out).toContain('???');
    expect(r.out).not.toContain('electric-blue');
    expect(r.out).toContain('motion:  auto');
    expect(r.out).toContain('reader:  off');
  });

  it('changes theme, motion, and reader mode', async () => {
    const g = setup(['candlelit', 'high-contrast']);
    expect((await g.run('settings theme high-contrast')).status).toBe(0);
    expect((await g.run('settings motion off')).status).toBe(0);
    expect((await g.run('settings reader on')).status).toBe(0);
    expect(g.get()).toMatchObject({ theme: 'high-contrast', motion: 'off', reader: true });
  });

  it('refuses unearned and unknown themes, and bad options', async () => {
    const g = setup(['candlelit']);
    expect((await g.run('settings theme parchment')).err).toBe(
      'settings: you have not earned the parchment theme yet\n',
    );
    expect((await g.run('settings theme plaid')).err).toBe('settings: no theme called plaid\n');
    expect((await g.run('settings motion sideways')).status).toBe(1);
    expect(g.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('turns the soundtrack on and off and sets its volume', async () => {
    const g = setup(['candlelit']);
    expect((await g.run('settings')).out).toContain('music:   on');
    expect((await g.run('settings music off')).status).toBe(0);
    expect((await g.run('settings volume 7')).status).toBe(0);
    expect(g.get()).toMatchObject({ music: false, volume: 7 });
    expect((await g.run('settings volume 11')).status).toBe(1);
    expect((await g.run('settings music loud')).status).toBe(1);
  });

  it('plays a found secret song, keeps unfound ones secret, and returns to auto', async () => {
    let current: Settings = { ...DEFAULT_SETTINGS };
    const registry = createRegistry().register(
      createSettingsCommand({
        get: () => current,
        set: (n) => (current = n),
        themes: () => [{ name: 'candlelit', available: true }],
        songs: () => [
          { name: 'rain', available: true },
          { name: 'harbor', available: false },
        ],
      }),
    );
    let out = '';
    let err = '';
    const shell = new Shell({
      vfs: buildWorld({ user: { name: 'a', groups: ['a'], home: '/home/a' } }),
      registry,
      terminal: { stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } },
    });
    await shell.run('settings');
    expect(out).toContain('rain');
    expect(out).toContain('???');
    expect(out).not.toContain('harbor');
    expect(await shell.run('settings song harbor')).toBe(1);
    expect(err).toBe('settings: you have not found the harbor song yet\n');
    expect(await shell.run('settings song rain')).toBe(0);
    expect(current.song).toBe('rain');
    expect(await shell.run('settings song auto')).toBe(0);
    expect(current.song).toBe('auto');
  });

  it('turns easy mode on and off', async () => {
    const g = setup(['candlelit']);
    expect((await g.run('settings')).out).toContain('easy:    off');
    expect((await g.run('settings easy on')).status).toBe(0);
    expect(g.get().easy).toBe(true);
    expect((await g.run('settings easy maybe')).status).toBe(1);
  });
});

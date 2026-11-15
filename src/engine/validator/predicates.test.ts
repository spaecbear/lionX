import { buildWorld } from '../vfs';
import { evaluate, type Predicate, type WorldView } from './predicates';

function view(extra: Partial<WorldView> = {}): WorldView {
  const vfs = buildWorld({
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    dirs: [
      '/home/apprentice/shelf',
      { path: '/vault', mode: '700', owner: 'lionx', group: 'lionx' },
    ],
    files: {
      '/home/apprentice/page': 'the true name is Ostra\n',
      '/vault/seal': { content: 'sealed', owner: 'lionx', group: 'lionx', mode: '640' },
    },
  });
  return { vfs, commands: [], reads: new Set(), processes: [], ...extra };
}

describe('evaluate', () => {
  it.each<[Predicate, boolean]>([
    [{ exists: '~/page' }, true],
    [{ exists: '~/nope' }, false],
    [{ missing: '~/nope' }, true],
    [{ isDir: '~/shelf' }, true],
    [{ isDir: '~/page' }, false],
    [{ isFile: '~/page' }, true],
    [{ contains: { path: '~/page', text: 'Ostra' } }, true],
    [{ contains: { path: '~/page', text: 'lionX' } }, false],
    [{ contains: { path: '~/page', pattern: '^the true name is [A-Z]\\w+$' } }, true],
    [{ contains: { path: '~/shelf', text: 'x' } }, false],
    [{ cwdIs: '/home/apprentice' }, true],
    [{ cwdIs: '~' }, true],
    [{ cwdIs: '/' }, false],
    [{ processRunning: 'lionX' }, false],
    [{ all: [{ exists: '~/page' }, { isDir: '~/shelf' }] }, true],
    [{ all: [{ exists: '~/page' }, { isDir: '~/page' }] }, false],
    [{ any: [{ exists: '~/nope' }, { isDir: '~/shelf' }] }, true],
    [{ not: { exists: '~/nope' } }, true],
    [{ all: [] }, true],
    [{ any: [] }, false],
  ])('%j -> %s', (p, want) => expect(evaluate(p, view())).toBe(want));

  it('sees through wards the player cannot pass', () => {
    const w = view();
    expect(w.vfs.exists('/vault/seal')).toBe(false); // the apprentice can't
    expect(evaluate({ exists: '/vault/seal' }, w)).toBe(true);
    expect(evaluate({ mode: { path: '/vault/seal', mode: '640' } }, w)).toBe(true);
    expect(evaluate({ mode: { path: '/vault/seal', mode: '600' } }, w)).toBe(false);
    expect(evaluate({ owner: { path: '/vault/seal', owner: 'lionx' } }, w)).toBe(true);
    expect(evaluate({ owner: { path: '/vault/seal', group: 'apprentice' } }, w)).toBe(false);
    expect(evaluate({ contains: { path: '/vault/seal', text: 'sealed' } }, w)).toBe(true);
    expect(w.vfs.credentials.user).toBe('apprentice');
  });

  it('perm checks one set of bits', () => {
    const w = view();
    // /vault/seal is 640: owner rw-, group r--, others ---
    expect(evaluate({ perm: { path: '/vault/seal', who: 'u', has: 'rw', lacks: 'x' } }, w)).toBe(
      true,
    );
    expect(evaluate({ perm: { path: '/vault/seal', who: 'g', has: 'r' } }, w)).toBe(true);
    expect(evaluate({ perm: { path: '/vault/seal', who: 'g', has: 'w' } }, w)).toBe(false);
    expect(evaluate({ perm: { path: '/vault/seal', who: 'o', lacks: 'rwx' } }, w)).toBe(true);
    expect(evaluate({ perm: { path: '/nope', who: 'o', lacks: 'r' } }, w)).toBe(false);
  });

  it('mode and owner on missing paths are false', () => {
    expect(evaluate({ mode: { path: '/x', mode: '644' } }, view())).toBe(false);
    expect(evaluate({ owner: { path: '/x', owner: 'root' } }, view())).toBe(false);
  });

  it('checking contents does not count as the player reading', () => {
    const w = view();
    let reads = 0;
    w.vfs.onRead = () => reads++;
    evaluate({ contains: { path: '~/page', text: 'x' } }, w);
    expect(reads).toBe(0);
  });

  it('ran and read look at this step’s events', () => {
    const w = view({
      commands: [
        { command: 'ls', args: ['-a'], status: 0 },
        { command: 'cat', args: ['missing'], status: 1 },
      ],
      reads: new Set(['/home/apprentice/page']),
      processes: ['spirit'],
    });
    expect(evaluate({ ran: 'ls' }, w)).toBe(true);
    expect(evaluate({ ran: { command: 'ls', args: ['-a'] } }, w)).toBe(true);
    expect(evaluate({ ran: { command: 'ls', args: ['-l'] } }, w)).toBe(false);
    expect(evaluate({ ran: 'cat' }, w)).toBe(false); // it failed
    expect(evaluate({ ran: { command: 'cat', status: 1 } }, w)).toBe(true);
    expect(evaluate({ read: '~/page' }, w)).toBe(true);
    expect(evaluate({ read: '/etc/x' }, w)).toBe(false);
    expect(evaluate({ processRunning: 'spirit' }, w)).toBe(true);
  });

  it('rejects unknown predicates', () => {
    expect(() => evaluate({ glow: 'x' } as unknown as Predicate, view())).toThrow(
      /Unknown predicate/,
    );
  });
});

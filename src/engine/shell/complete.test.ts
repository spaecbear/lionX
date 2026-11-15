import { buildWorld } from '../vfs';
import { complete, escapeForShell } from './complete';

const vfs = () =>
  buildWorld({
    user: { name: 'apprentice', groups: ['apprentice'], home: '/home/apprentice' },
    dirs: ['/home/apprentice/notes', '/home/apprentice/nightshade', '/atrium', '/archive'],
    files: {
      '/home/apprentice/welcome.txt': '',
      '/home/apprentice/.secret': '',
      '/home/apprentice/notes/page one': '',
      '/home/apprentice/notes/page two': '',
      '/home/apprentice/notes/index': '',
      '/atrium/map': '',
    },
  });

const commands = ['cat', 'cd', 'clear', 'echo', 'less'];

/** Apply the completion and return the resulting line, or the candidate list. */
function tab(line: string, cursor = line.length) {
  const r = complete(line, cursor, { vfs: vfs(), commands });
  if (r.candidates.length) return r.candidates;
  return line.slice(0, r.start) + r.replacement + line.slice(cursor);
}

describe('complete', () => {
  it.each<[string, string | string[]]>([
    ['ec', 'echo '],
    ['c', ['cat', 'cd', 'clear']],
    ['cl', 'clear '],
    ['zz', 'zz'],
    ['', ['cat', 'cd', 'clear', 'echo', 'less']],
    ['X=1 ec', 'X=1 echo '],
    ['echo a | le', 'echo a | less '],
    ['echo a && e', 'echo a && echo '],
    ['echo a; c', ['cat', 'cd', 'clear']],
    ['cat we', 'cat welcome.txt '],
    ['cat n', ['nightshade/', 'notes/']],
    ['cat no', 'cat notes/'],
    ['cat notes/', ['index', 'page one', 'page two']],
    ['cat notes/page', 'cat notes/page\\ '],
    ['cat notes/page\\ ', ['page one', 'page two']],
    ['cat notes/page\\ o', 'cat notes/page\\ one '],
    ['cat notes/i', 'cat notes/index '],
    ['cat "notes/i', 'cat notes/index '],
    ['cat .', 'cat .secret '],
    ['cat /at', 'cat /atrium/'],
    ['cat /a', ['archive/', 'atrium/']],
    ['cat /atrium/m', 'cat /atrium/map '],
    ['cat ~/no', 'cat ~/notes/'],
    ['cat ~/', ['nightshade/', 'notes/', 'welcome.txt']],
    ['cat missing/x', 'cat missing/x'],
    ['./no', './notes/'],
    ['echo x > we', 'echo x > welcome.txt '],
    ['cat <we', 'cat <welcome.txt '],
    ['cat zz', 'cat zz'],
  ])('%j', (line, want) => {
    expect(tab(line)).toEqual(want);
  });

  it('completes the word at the cursor, keeping text after it', () => {
    expect(tab('cat no | less', 6)).toBe('cat notes/ | less');
  });

  it('escapeForShell escapes specials but not ~', () => {
    expect(escapeForShell("a b'$*~")).toBe("a\\ b\\'\\$\\*~");
  });
});

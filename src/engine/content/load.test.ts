import { stringify } from 'yaml';
import { ContentError, loadCoaching, loadWing } from './load';

const minimal = () => ({
  id: 'w',
  world: { user: { name: 'a', groups: ['a'], home: '/home/a' } },
  lessons: [
    {
      id: 'l',
      steps: [
        {
          id: 's',
          guidance: { exact: 'Type `pwd`.' },
          hints: ['a', 'b', 'c'],
          goal: { ran: 'pwd' },
        },
      ],
    },
  ],
});

type Doc = ReturnType<typeof minimal> & Record<string, unknown>;
const load = (mutate: (d: Doc) => void = () => {}) => {
  const d = minimal() as Doc;
  mutate(d);
  return loadWing(stringify(d), 'test.yaml');
};
const step = (d: Doc) => d.lessons[0].steps[0] as Record<string, unknown>;

describe('loadWing', () => {
  it('loads a minimal wing with defaults', () => {
    const w = load();
    expect(w.lessons[0].steps[0]).toMatchObject({
      guide: 'exact',
      hints: ['a', 'b', 'c'],
      goal: { ran: 'pwd' },
    });
    expect(w.lessons[0].spells).toEqual([]);
  });

  it('accepts a single string where a list of lines is expected', () => {
    expect(load((d) => (d.intro = 'Hello.')).intro).toEqual(['Hello.']);
  });

  it('parses nested goals', () => {
    const w = load((d) => {
      step(d).goal = {
        all: [{ exists: '/x' }, { not: { any: [{ mode: { path: '/x', mode: '640' } }] } }],
      };
    });
    expect(w.lessons[0].steps[0].goal).toEqual({
      all: [{ exists: '/x' }, { not: { any: [{ mode: { path: '/x', mode: '640' } }] } }],
    });
  });

  it.each<[string, (d: Doc) => void, RegExp]>([
    ['bad yaml', () => {}, /invalid YAML/],
    ['missing lessons', (d) => delete (d as Partial<Doc>).lessons, /lessons: expected a list/],
    ['empty lessons', (d) => (d.lessons = []), /at least one lesson/],
    ['unknown field', (d) => (d.colour = 'red'), /\(root\)\.colour: unknown field/],
    ['two hints', (d) => (step(d).hints = ['a', 'b']), /steps\[0\]\.hints: expected exactly 3/],
    ['unknown goal', (d) => (step(d).goal = { glows: '/x' }), /unknown goal "glows"/],
    ['two goal kinds', (d) => (step(d).goal = { exists: '/a', isDir: '/b' }), /exactly one kind/],
    ['bad mode', (d) => (step(d).goal = { mode: { path: '/a', mode: 'rw' } }), /expected octal/],
    [
      'contains without text',
      (d) => (step(d).goal = { contains: { path: '/a' } }),
      /needs text or pattern/,
    ],
    [
      'owner without owner',
      (d) => (step(d).goal = { owner: { path: '/a' } }),
      /needs owner or group/,
    ],
    ['bad guide', (d) => (step(d).guide = 'vague'), /guide: expected one of/],
    [
      'missing fade level',
      (d) => (step(d).guide = 'goal'),
      /guidance\.goal: expected non-empty text/,
    ],
    ['em dash', (d) => (d.intro = ['Wait — no.']), /no em dashes/],
    ['says level', (d) => (d.outro = ['Next level!']), /must not say/],
    ['bad regex', (d) => (d.coaching = [{ line: '(', say: 'x' }]), /invalid pattern/],
    ['coaching without match', (d) => (d.coaching = [{ say: 'x' }]), /needs line or stderr/],
    [
      'duplicate step ids',
      (d) => d.lessons[0].steps.push({ ...d.lessons[0].steps[0] }),
      /duplicate id "s"/,
    ],
  ])('rejects %s', (name, mutate, msg) => {
    const run = () => (name === 'bad yaml' ? loadWing('a: [', 'test.yaml') : load(mutate));
    expect(run).toThrow(ContentError);
    expect(run).toThrow(msg);
  });

  it('names the file in errors', () => {
    expect(() => load((d) => (d.lessons = []))).toThrow(/^test\.yaml: /);
  });
});

describe('loadCoaching', () => {
  it('loads rules', () => {
    expect(loadCoaching('rules:\n  - line: "^dir"\n    say: "Use ls."\n')).toEqual([
      { line: '^dir', stderr: undefined, failed: undefined, say: 'Use ls.' },
    ]);
  });
});

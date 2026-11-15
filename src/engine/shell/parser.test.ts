import type { Script, Word } from './ast';
import { ShellSyntaxError } from './lexer';
import { parse } from './parser';

const text = (w: Word) => w.parts.map((p) => (p.kind === 'var' ? `$${p.name}` : p.text)).join('');

/** Render an AST compactly so tests read like shell. */
function render(s: Script): string {
  return s.entries
    .map(({ node, background }) => {
      const pipe = (p: (typeof node)['first']) =>
        p.commands
          .map((c) =>
            [
              ...c.assignments.map((a) => `${a.name}=${text(a.value)}`),
              ...c.words.map(text),
              ...c.redirects.map((r) => `${r.fd}${r.op}${text(r.target)}`),
            ].join(' '),
          )
          .join(' | ');
      const chain = [pipe(node.first), ...node.rest.map((r) => `${r.op} ${pipe(r.pipeline)}`)];
      return chain.join(' ') + (background ? ' &' : ' ;');
    })
    .join(' ');
}

describe('parse', () => {
  it.each<[string, string]>([
    ['', ''],
    ['ls', 'ls ;'],
    ['ls -l /', 'ls -l / ;'],
    ['a | b | c', 'a | b | c ;'],
    ['a && b || c', 'a && b || c ;'],
    ['a; b', 'a ; b ;'],
    ['a; b;', 'a ; b ;'],
    ['a & b', 'a & b ;'],
    ['a &', 'a &'],
    ['a > f', 'a 1>f ;'],
    ['a >> f', 'a 1>>f ;'],
    ['a < f', 'a 0<f ;'],
    ['a 2> f', 'a 2>f ;'],
    ['a > f 2>&1', 'a 1>f 2>&1 ;'],
    ['a &> f', 'a 1>f 2>&1 ;'],
    ['a &>> f', 'a 1>>f 2>&1 ;'],
    ['> f', '1>f ;'],
    ['>f a b', 'a b 1>f ;'],
    ['X=1', 'X=1 ;'],
    ['X=1 Y=2 cmd', 'X=1 Y=2 cmd ;'],
    ['X= cmd', 'X= cmd ;'],
    ['X="a b" cmd', 'X=a b cmd ;'],
    ['cmd X=1', 'cmd X=1 ;'],
    ['1X=1', '1X=1 ;'],
    ['grep x < in | sort > out && echo ok', 'grep x 0<in | sort 1>out && echo ok ;'],
  ])('%j', (input, expected) => {
    expect(render(parse(input))).toBe(expected);
  });

  it('marks assignment words only before the command name', () => {
    const cmd = parse('A=1 echo B=2').entries[0].node.first.commands[0];
    expect(cmd.assignments.map((a) => a.name)).toEqual(['A']);
    expect(cmd.words.map(text)).toEqual(['echo', 'B=2']);
  });

  it.each<[string, string, boolean]>([
    ['| a', '|', false],
    ['a |', 'newline', true],
    ['a &&', 'newline', true],
    ['a ||', 'newline', true],
    ['&& a', '&&', false],
    ['; a', ';', false],
    ['a ; ; b', ';', false],
    ['a >', 'newline', true],
    ['a > | b', '|', false],
    ['a & & b', '&', false],
    ['a > >f', '>', false],
  ])('syntax error for %j near `%s`', (input, near, incomplete) => {
    try {
      parse(input);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShellSyntaxError);
      expect((e as Error).message).toBe(`syntax error near unexpected token \`${near}'`);
      expect((e as ShellSyntaxError).incomplete).toBe(incomplete);
    }
  });
});

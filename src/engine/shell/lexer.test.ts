import { ShellSyntaxError, tokenize, type Token } from './lexer';

/** Compact token rendering: words show parts, quoted parts in «», vars as $NAME. */
function show(tokens: Token[]): string[] {
  return tokens.map((t) => {
    if (t.type === 'op') return t.value;
    if (t.type === 'redir') return `${t.fd ?? ''}${t.value}`;
    return t.parts
      .map((p) =>
        p.kind === 'var'
          ? p.quoted
            ? `«$${p.name}»`
            : `$${p.name}`
          : p.quoted
            ? `«${p.text}»`
            : p.text,
      )
      .join('');
  });
}

describe('tokenize', () => {
  it.each<[string, string[]]>([
    ['', []],
    ['   ', []],
    ['ls', ['ls']],
    ['ls  -la   /tmp', ['ls', '-la', '/tmp']],
    ["echo 'a b'", ['echo', '«a b»']],
    ['echo "a b"', ['echo', '«a b»']],
    ['echo a\\ b', ['echo', 'a« »b']],
    ['echo "x$HOME"', ['echo', '«x»«$HOME»']],
    ["echo '$HOME'", ['echo', '«$HOME»']],
    ['echo ${HOME}x', ['echo', '$HOMEx']],
    ['echo $?', ['echo', '$?']],
    ['echo ${?}', ['echo', '$?']],
    ['echo $ $1x', ['echo', '$', '$1x']],
    ['echo "a\\"b\\$c\\d"', ['echo', '«a"b$c\\d»']],
    ['echo ""', ['echo', '«»']],
    ['echo a""b', ['echo', 'a«»b']],
    ['a|b', ['a', '|', 'b']],
    ['a||b&&c;d&', ['a', '||', 'b', '&&', 'c', ';', 'd', '&']],
    ['a>f', ['a', '>', 'f']],
    ['a >>f <g', ['a', '>>', 'f', '<', 'g']],
    ['a 2>f', ['a', '2>', 'f']],
    ['a 2>>f', ['a', '2>>', 'f']],
    ['a 2>&1', ['a', '2>&', '1']],
    ['a a2>f', ['a', 'a2', '>', 'f']],
    ['a "2">f', ['a', '«2»', '>', 'f']],
    ['a &>f', ['a', '&>', 'f']],
    ['a &>>f', ['a', '&>>', 'f']],
    ['ls # a comment', ['ls']],
    ['echo a#b', ['echo', 'a#b']],
    ['echo a\\\nb', ['echo', 'ab']],
    ['*.txt', ['*.txt']],
  ])('%j', (input, expected) => {
    expect(show(tokenize(input))).toEqual(expected);
  });

  it.each([
    ["echo 'open", true],
    ['echo "open', true],
    ['echo trailing\\', true],
    ['echo ${open', true],
    ['echo ${bad-name}', false],
    ['a ;; b', false],
  ])('rejects %j (incomplete=%s)', (input, incomplete) => {
    try {
      tokenize(input);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ShellSyntaxError);
      expect((e as ShellSyntaxError).incomplete).toBe(incomplete);
    }
  });
});

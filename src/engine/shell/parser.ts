import type { AndOr, Pipeline, Redirect, Script, SimpleCommand, Word } from './ast';
import { ShellSyntaxError, tokenize, type Token } from './lexer';

const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=/;

function describe(tok: Token | undefined): string {
  if (!tok) return 'newline';
  if (tok.type === 'op') return tok.value;
  if (tok.type === 'redir') return (tok.fd ?? '') + tok.value;
  return 'word';
}

function unexpected(tok: Token | undefined): ShellSyntaxError {
  // A dangling `|`, `&&`, or `||` could be continued on the next line.
  return new ShellSyntaxError(`syntax error near unexpected token \`${describe(tok)}'`, !tok);
}

/** Parse a command line into an AST. Throws ShellSyntaxError like Bash would. */
export function parse(input: string): Script {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];

  const parseCommand = (): SimpleCommand => {
    const cmd: SimpleCommand = { type: 'command', assignments: [], words: [], redirects: [] };
    for (;;) {
      const tok = peek();
      if (!tok || tok.type === 'op') break;
      pos++;
      if (tok.type === 'redir') {
        const target = peek();
        if (!target || target.type !== 'word') throw unexpected(target);
        pos++;
        cmd.redirects.push(...makeRedirects(tok, { parts: target.parts }));
        continue;
      }
      const first = tok.parts[0];
      const m = first?.kind === 'lit' && !first.quoted ? ASSIGN.exec(first.text) : null;
      if (m && cmd.words.length === 0) {
        const restText = (first as { text: string }).text.slice(m[0].length);
        const valueParts = [
          ...(restText ? [{ kind: 'lit' as const, text: restText, quoted: false }] : []),
          ...tok.parts.slice(1),
        ];
        cmd.assignments.push({ name: m[1], value: { parts: valueParts } });
        continue;
      }
      cmd.words.push({ parts: tok.parts });
    }
    if (!cmd.words.length && !cmd.assignments.length && !cmd.redirects.length) {
      throw unexpected(peek());
    }
    return cmd;
  };

  const parsePipeline = (): Pipeline => {
    const commands = [parseCommand()];
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '|') {
      pos++;
      commands.push(parseCommand());
    }
    return { type: 'pipeline', commands };
  };

  const parseAndOr = (): AndOr => {
    const node: AndOr = { type: 'andor', first: parsePipeline(), rest: [] };
    for (;;) {
      const tok = peek();
      if (tok?.type !== 'op' || (tok.value !== '&&' && tok.value !== '||')) break;
      pos++;
      node.rest.push({ op: tok.value, pipeline: parsePipeline() });
    }
    return node;
  };

  const script: Script = { type: 'script', entries: [] };
  while (pos < tokens.length) {
    const node = parseAndOr();
    const tok = peek();
    let background = false;
    if (tok?.type === 'op' && (tok.value === ';' || tok.value === '&')) {
      background = tok.value === '&';
      pos++;
    } else if (tok) {
      throw unexpected(tok);
    }
    script.entries.push({ node, background });
  }
  return script;
}

function makeRedirects(tok: Extract<Token, { type: 'redir' }>, target: Word): Redirect[] {
  const one: Word = { parts: [{ kind: 'lit', text: '1', quoted: false }] };
  switch (tok.value) {
    case '<':
      return [{ fd: tok.fd ?? 0, op: '<', target }];
    case '>':
    case '>>':
      return [{ fd: tok.fd ?? 1, op: tok.value, target }];
    case '>&':
      return [{ fd: tok.fd ?? 1, op: '>&', target }];
    case '&>':
    case '&>>':
      return [
        { fd: 1, op: tok.value === '&>' ? '>' : '>>', target },
        { fd: 2, op: '>&', target: one },
      ];
  }
}

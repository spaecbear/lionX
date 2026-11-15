import type { WordPart } from './ast';

export type Token =
  | { type: 'word'; parts: WordPart[] }
  | { type: 'op'; value: Operator }
  /** A redirect operator with an explicit fd, e.g. `2>` or `2>&`. */
  | { type: 'redir'; fd: number | null; value: RedirOperator };

export type Operator = '|' | '||' | '&' | '&&' | ';';
export type RedirOperator = '>' | '>>' | '<' | '>&' | '&>' | '&>>';

export class ShellSyntaxError extends Error {
  /** True when more input could complete the command (open quote, trailing backslash). */
  readonly incomplete: boolean;
  constructor(message: string, incomplete = false) {
    super(message);
    this.name = 'ShellSyntaxError';
    this.incomplete = incomplete;
  }
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const BREAK = /[\s|&;<>]/;

/** Split a command line into words and operators, preserving quoting info. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let parts: WordPart[] | null = null;

  const pushLit = (text: string, quoted: boolean) => {
    parts ??= [];
    const last = parts[parts.length - 1];
    if (last && last.kind === 'lit' && last.quoted === quoted) last.text += text;
    else parts.push({ kind: 'lit', text, quoted });
  };
  const endWord = () => {
    if (parts) tokens.push({ type: 'word', parts });
    parts = null;
  };

  /** Parse `$...` at input[i] (which is '$'). Returns false if it's a literal `$`. */
  const readVar = (quoted: boolean): boolean => {
    const next = input[i + 1];
    if (next === '?') {
      parts ??= [];
      parts.push({ kind: 'var', name: '?', quoted });
      i += 2;
      return true;
    }
    if (next === '{') {
      const close = input.indexOf('}', i + 2);
      if (close === -1)
        throw new ShellSyntaxError("unexpected EOF while looking for matching `}'", true);
      const name = input.slice(i + 2, close);
      if (!/^([A-Za-z_][A-Za-z0-9_]*|\?)$/.test(name)) {
        throw new ShellSyntaxError(`\${${name}}: bad substitution`);
      }
      parts ??= [];
      parts.push({ kind: 'var', name, quoted });
      i = close + 1;
      return true;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let j = i + 1;
      while (j < input.length && NAME_CHAR.test(input[j])) j++;
      parts ??= [];
      parts.push({ kind: 'var', name: input.slice(i + 1, j), quoted });
      i = j;
      return true;
    }
    return false;
  };

  while (i < input.length) {
    const c = input[i];

    if (/\s/.test(c)) {
      endWord();
      i++;
      continue;
    }

    if (c === '#' && parts === null) {
      break; // comment to end of line
    }

    if (c === '\\') {
      if (i + 1 >= input.length) throw new ShellSyntaxError('unexpected end after backslash', true);
      if (input[i + 1] === '\n') {
        i += 2; // line continuation
        continue;
      }
      pushLit(input[i + 1], true);
      i += 2;
      continue;
    }

    if (c === "'") {
      const close = input.indexOf("'", i + 1);
      if (close === -1) {
        throw new ShellSyntaxError("unexpected EOF while looking for matching `''", true);
      }
      pushLit(input.slice(i + 1, close), true);
      i = close + 1;
      continue;
    }

    if (c === '"') {
      i++;
      pushLit('', true); // "" is still a (quoted, empty) word
      for (;;) {
        if (i >= input.length) {
          throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'', true);
        }
        const d = input[i];
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\' && i + 1 < input.length && '$`"\\\n'.includes(input[i + 1])) {
          if (input[i + 1] !== '\n') pushLit(input[i + 1], true);
          i += 2;
          continue;
        }
        if (d === '$' && readVar(true)) continue;
        pushLit(d, true);
        i++;
      }
      continue;
    }

    if (c === '$' && readVar(false)) continue;

    if (c === '>' || c === '<') {
      // `2>` style: the word so far is a lone unquoted fd number.
      let fd: number | null = null;
      const p = parts as WordPart[] | null;
      if (p && p.length === 1 && p[0].kind === 'lit' && !p[0].quoted && /^\d$/.test(p[0].text)) {
        fd = Number(p[0].text);
        parts = null;
      } else {
        endWord();
      }
      let value: RedirOperator;
      if (c === '<') {
        value = '<';
        i++;
      } else if (input[i + 1] === '>') {
        value = '>>';
        i += 2;
      } else if (input[i + 1] === '&') {
        value = '>&';
        i += 2;
      } else {
        value = '>';
        i++;
      }
      tokens.push({ type: 'redir', fd, value });
      continue;
    }

    if (c === '|' || c === '&' || c === ';') {
      endWord();
      const two = input.slice(i, i + 2);
      if (two === '&>') {
        const append = input[i + 2] === '>';
        tokens.push({ type: 'redir', fd: null, value: append ? '&>>' : '&>' });
        i += append ? 3 : 2;
      } else if (two === '||' || two === '&&') {
        tokens.push({ type: 'op', value: two });
        i += 2;
      } else if (two === ';;') {
        throw new ShellSyntaxError("syntax error near unexpected token `;;'");
      } else {
        tokens.push({ type: 'op', value: c as Operator });
        i++;
      }
      continue;
    }

    // Plain unquoted run of characters.
    let j = i;
    while (j < input.length && !BREAK.test(input[j]) && !'\'"\\$'.includes(input[j])) j++;
    if (j === i) j = i + 1; // lone `$` that is not a variable
    pushLit(input.slice(i, j), false);
    i = j;
  }
  endWord();
  return tokens;
}

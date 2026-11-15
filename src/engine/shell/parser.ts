import type {
  AndOr,
  Command,
  ForCommand,
  IfCommand,
  ListEntry,
  Pipeline,
  Redirect,
  Script,
  SimpleCommand,
  Word,
} from './ast';
import { ShellSyntaxError, tokenize, type Token } from './lexer';

const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=/;

function describe(tok: Token | undefined): string {
  if (!tok) return 'newline';
  if (tok.type === 'op') return tok.value === '\n' ? 'newline' : tok.value;
  if (tok.type === 'redir') return (tok.fd ?? '') + tok.value;
  return tok.parts.map((p) => (p.kind === 'var' ? '$' + p.name : p.text)).join('');
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

  /** The plain text of a word token, if it is a single unquoted literal (for reserved words). */
  const keyword = (tok: Token | undefined): string | null =>
    tok?.type === 'word' &&
    tok.parts.length === 1 &&
    tok.parts[0].kind === 'lit' &&
    !tok.parts[0].quoted
      ? tok.parts[0].text
      : null;
  const RESERVED_ENDS = ['do', 'done', 'then', 'elif', 'else', 'fi'];

  const expectWord = (word: string) => {
    const tok = peek();
    if (keyword(tok) !== word) throw unexpected(tok);
    pos++;
  };
  const skipSeparators = () => {
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '\n') pos++;
  };

  /** Commands until one of `stops` appears in command position (or input ends). */
  const parseList = (stops: string[]): ListEntry[] => {
    const entries: ListEntry[] = [];
    for (;;) {
      skipSeparators();
      const tok = peek();
      if (!tok) {
        if (stops.length) throw new ShellSyntaxError(`syntax error: unexpected end of file`, true);
        return entries;
      }
      const kw = keyword(tok);
      if (kw && stops.includes(kw)) return entries;
      if (kw && RESERVED_ENDS.includes(kw)) throw unexpected(tok);
      const node = parseAndOr();
      const sep = peek();
      let background = false;
      if (sep?.type === 'op' && (sep.value === ';' || sep.value === '&' || sep.value === '\n')) {
        background = sep.value === '&';
        pos++;
      } else if (sep && !(keyword(sep) && stops.includes(keyword(sep)!))) {
        throw unexpected(sep);
      }
      entries.push({ node, background });
    }
  };

  const parseFor = (): ForCommand => {
    pos++; // for
    const nameTok = peek();
    const name = keyword(nameTok);
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw unexpected(nameTok);
    pos++;
    let words: Word[] | null = null;
    if (keyword(peek()) === 'in') {
      pos++;
      words = [];
      while (peek()?.type === 'word') {
        words.push({ parts: (peek() as { parts: Word['parts'] }).parts });
        pos++;
      }
    }
    // `; do` or a newline before do.
    if (peek()?.type === 'op' && (peek() as { value: string }).value === ';') pos++;
    skipSeparators();
    if (!peek()) throw new ShellSyntaxError('syntax error: unexpected end of file', true);
    expectWord('do');
    const body = parseList(['done']);
    expectWord('done');
    return { type: 'for', name, words, body };
  };

  const parseIf = (): IfCommand => {
    pos++; // if
    const branches: IfCommand['branches'] = [];
    let elseBody: ListEntry[] | null = null;
    for (;;) {
      const cond = parseList(['then']);
      expectWord('then');
      const body = parseList(['elif', 'else', 'fi']);
      branches.push({ cond, body });
      const kw = keyword(peek());
      pos++;
      if (kw === 'elif') continue;
      if (kw === 'else') {
        elseBody = parseList(['fi']);
        expectWord('fi');
      }
      break;
    }
    return { type: 'if', branches, elseBody };
  };

  const parseAnyCommand = (): Command => {
    const kw = keyword(peek());
    if (kw === 'for') return parseFor();
    if (kw === 'if') return parseIf();
    return parseCommand();
  };

  const parsePipeline = (): Pipeline => {
    const commands: Command[] = [parseAnyCommand()];
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '|') {
      pos++;
      commands.push(parseAnyCommand());
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

  const script: Script = { type: 'script', entries: parseList([]) };
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

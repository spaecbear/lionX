/**
 * Shell AST. Words keep their quoting so expansion ($VAR, ~, globs, field
 * splitting) can happen at run time, after earlier commands changed the world.
 */

/** A piece of a word. `quoted` pieces are never field-split or globbed. */
export type WordPart =
  | { kind: 'lit'; text: string; quoted: boolean }
  /** `$NAME`, `${NAME}`, or `$?`. `quoted` means inside double quotes. */
  | { kind: 'var'; name: string; quoted: boolean };

export interface Word {
  parts: WordPart[];
}

export type RedirectOp = '>' | '>>' | '<' | '>&';

export interface Redirect {
  /** File descriptor being redirected. `&>` and `&>>` expand to fd 1 then `2>&1`. */
  fd: number;
  op: RedirectOp;
  /** File target, or for `>&` the word naming the fd to duplicate. */
  target: Word;
}

export interface Assignment {
  name: string;
  value: Word;
}

export interface SimpleCommand {
  type: 'command';
  assignments: Assignment[];
  words: Word[];
  redirects: Redirect[];
}

export interface Pipeline {
  type: 'pipeline';
  commands: SimpleCommand[];
}

export interface AndOr {
  type: 'andor';
  first: Pipeline;
  rest: { op: '&&' | '||'; pipeline: Pipeline }[];
}

export interface ListEntry {
  node: AndOr;
  /** Ended with `&`. */
  background: boolean;
}

export interface Script {
  type: 'script';
  entries: ListEntry[];
}

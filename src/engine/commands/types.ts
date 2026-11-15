import type { Vfs } from '../vfs';
import type { JobTable, ProcessTable, ProcSpec } from '../processes';

/** Where a command writes. Writes may throw a VfsError if a redirect target becomes unwritable. */
export interface OutStream {
  write(text: string): void;
}

export interface IO {
  /** Everything piped or redirected into the command (empty when there is none). */
  stdin: string;
  /** True when stdin is the terminal rather than a pipe or file. */
  stdinIsTerminal: boolean;
  stdout: OutStream;
  stderr: OutStream;
  /** True when stdout goes straight to the terminal (not a pipe or file). */
  stdoutIsTerminal: boolean;
  /** Interactive terminal access, present only when stdout is the terminal. */
  tty?: Tty;
}

/** What interactive programs like `less` need from the terminal. */
export interface Tty {
  readonly rows: number;
  readonly cols: number;
  /** Wait for the next keypress (a character or escape sequence). */
  readKey(): Promise<string>;
  /** Read a line without echoing it (passwords). Optional; programs fall back to readKey. */
  readSecret?(): Promise<string | null>;
  /** Wait up to `ms` for a key; null if none came (for programs that also watch the clock). */
  pollKey?(ms: number): Promise<string | null>;
}

export interface ShellContext {
  vfs: Vfs;
  /** Shell and environment variables (one namespace in this game). */
  env: Map<string, string>;
  registry: CommandRegistry;
  /** Name used in shell-level error messages, e.g. "bash". */
  shellName: string;
  /** The world's processes, once the Haunted Stacks have woken (else undefined). */
  processes?: ProcessTable;
  jobs?: JobTable;
  /** The pid of the shell itself (for ps and for parenting jobs). */
  shellPid?: number;
}

export interface Command {
  name: string;
  /** Which wing teaches this spell (1-9). 0 means always available. */
  unlockedInAct: number;
  manPage: string;
  /** Short usage text printed by `--help`. */
  help?: string;
  /**
   * For long-running commands (like sleep): the process to start when run
   * with `&`, or an error message. Commands without this run to completion.
   */
  background?(args: string[], ctx: ShellContext): ProcSpec | string;
  run(args: string[], io: IO, ctx: ShellContext): Promise<number>;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(...cmds: Command[]): this {
    for (const c of cmds) this.commands.set(c.name, c);
    return this;
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** Sorted command names, for tab completion and chips. */
  names(): string[] {
    return [...this.commands.keys()].sort();
  }
}

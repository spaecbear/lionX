import type { Vfs } from '../vfs';

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
}

export interface ShellContext {
  vfs: Vfs;
  /** Shell and environment variables (one namespace in this game). */
  env: Map<string, string>;
  registry: CommandRegistry;
  /** Name used in shell-level error messages, e.g. "bash". */
  shellName: string;
}

export interface Command {
  name: string;
  /** Which wing teaches this spell (1-9). 0 means always available. */
  unlockedInAct: number;
  manPage: string;
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

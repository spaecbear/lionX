import { VfsError, type Vfs } from '../vfs';
import type { Command, CommandRegistry, IO, OutStream, ShellContext, Tty } from '../commands/types';
import type { AndOr, Pipeline, Redirect, SimpleCommand, Word } from './ast';
import { expandWord, expandWordToString, type ExpandEnv } from './expand';
import { ShellSyntaxError } from './lexer';
import { parse } from './parser';

export interface ShellOptions {
  vfs: Vfs;
  registry: CommandRegistry;
  /** Terminal output. In the game this is xterm; in tests, a buffer. */
  terminal: { stdout: OutStream; stderr: OutStream };
  env?: Record<string, string>;
  shellName?: string;
  /** Interactive terminal for pagers. Absent in headless use. */
  tty?: Tty;
  /** Whether the player has learned a command yet. Defaults to everything known. */
  isUnlocked?: (cmd: Command) => boolean;
}

/** In-world reply when a command exists but the player hasn't learned it. */
export const LOCKED_MESSAGE = "You don't know that spell yet.";

export const DEV_NULL = '/dev/null';

const nullSink: OutStream = { write() {} };

/** Collects everything written, for pipes. */
class BufferSink implements OutStream {
  text = '';
  write(s: string) {
    this.text += s;
  }
}

class FileSink implements OutStream {
  constructor(
    private vfs: Vfs,
    private path: string,
  ) {}
  write(s: string) {
    if (s) this.vfs.appendFile(this.path, s);
  }
}

interface Fds {
  /** null means "the terminal", which has no buffered input in this game. */
  stdin: string | null;
  out: OutStream;
  err: OutStream;
}

class RedirectError extends Error {}

/**
 * Runs command lines against the command registry and the VFS.
 *
 * Pipelines run stage by stage: each command's full stdout becomes the next
 * one's stdin. That is enough for the game's finite text and keeps commands
 * simple. `&` runs the job right away and prints a job line, until Phase 7's
 * process table takes over background work.
 */
export class Shell {
  readonly vfs: Vfs;
  readonly registry: CommandRegistry;
  readonly env: Map<string, string>;
  readonly shellName: string;
  lastStatus = 0;
  tty?: Tty;
  isUnlocked: (cmd: Command) => boolean;
  /** Where command output goes when not redirected. The UI may swap these. */
  terminal: ShellOptions['terminal'];
  private nextJob = 1;
  private nextPid = 1000;

  constructor(opts: ShellOptions) {
    this.vfs = opts.vfs;
    this.registry = opts.registry;
    this.terminal = opts.terminal;
    this.shellName = opts.shellName ?? 'bash';
    this.env = new Map(Object.entries(opts.env ?? {}));
    this.tty = opts.tty;
    this.isUnlocked = opts.isUnlocked ?? (() => true);
    if (!this.env.has('HOME')) this.env.set('HOME', this.vfs.home);
  }

  /** Run one line of input. Returns the exit status (also stored in `$?`). */
  async run(line: string): Promise<number> {
    let script;
    try {
      script = parse(line);
    } catch (e) {
      if (!(e instanceof ShellSyntaxError)) throw e;
      this.terminal.stderr.write(`${this.shellName}: ${e.message}\n`);
      return (this.lastStatus = 2);
    }
    for (const entry of script.entries) {
      if (entry.background) {
        const job = this.nextJob++;
        this.terminal.stderr.write(`[${job}] ${this.nextPid++}\n`);
        await this.runAndOr(entry.node);
        this.lastStatus = 0;
      } else {
        await this.runAndOr(entry.node);
      }
    }
    return this.lastStatus;
  }

  private async runAndOr(node: AndOr): Promise<void> {
    this.lastStatus = await this.runPipeline(node.first);
    for (const { op, pipeline } of node.rest) {
      if ((op === '&&') === (this.lastStatus === 0)) {
        this.lastStatus = await this.runPipeline(pipeline);
      }
    }
  }

  private async runPipeline(p: Pipeline): Promise<number> {
    let input: string | null = null;
    let status = 0;
    for (let i = 0; i < p.commands.length; i++) {
      const last = i === p.commands.length - 1;
      const pipe = last ? null : new BufferSink();
      status = await this.runCommand(p.commands[i], {
        stdin: input,
        out: pipe ?? this.terminal.stdout,
        err: this.terminal.stderr,
      });
      input = pipe ? pipe.text : null;
    }
    return status;
  }

  private expandEnv(env = this.env): ExpandEnv {
    return { vfs: this.vfs, env, lastStatus: this.lastStatus };
  }

  private async runCommand(cmd: SimpleCommand, fds: Fds): Promise<number> {
    const ex = this.expandEnv();
    const argv = cmd.words.flatMap((w) => expandWord(w, ex));
    const assigned = cmd.assignments.map((a) => [a.name, expandWordToString(a.value, ex)] as const);

    try {
      fds = this.applyRedirects(cmd.redirects, fds);
    } catch (e) {
      if (e instanceof RedirectError) {
        fds.err.write(`${this.shellName}: ${e.message}\n`);
        return 1;
      }
      throw e;
    }

    if (argv.length === 0) {
      for (const [k, v] of assigned) this.env.set(k, v);
      return 0;
    }

    const [name, ...args] = argv;
    const command = this.registry.get(name);
    if (!command) {
      fds.err.write(`${this.shellName}: ${name}: command not found\n`);
      return 127;
    }

    if (!this.isUnlocked(command)) {
      fds.err.write(`${name}: ${LOCKED_MESSAGE}\n`);
      return 127;
    }

    const env = assigned.length ? new Map([...this.env, ...assigned]) : this.env;
    const ctx: ShellContext = {
      vfs: this.vfs,
      env,
      registry: this.registry,
      shellName: this.shellName,
    };
    const io: IO = {
      stdin: fds.stdin ?? '',
      stdinIsTerminal: fds.stdin === null,
      stdout: fds.out,
      stderr: fds.err,
      // Only a real terminal counts; headless runs behave like output to a pipe.
      stdoutIsTerminal: fds.out === this.terminal.stdout && this.tty !== undefined,
    };
    if (io.stdoutIsTerminal && this.tty) io.tty = this.tty;
    try {
      return await command.run(args, io, ctx);
    } catch (e) {
      // A redirect target that became unwritable mid-command, or a buggy plugin.
      const msg = e instanceof VfsError ? e.message : `${name}: ${String(e)}`;
      fds.err.write(`${this.shellName}: ${msg}\n`);
      return 1;
    }
  }

  /** Apply redirects left to right, like Bash. Throws RedirectError on failure. */
  private applyRedirects(redirects: Redirect[], fds: Fds): Fds {
    const out = { ...fds };
    for (const r of redirects) {
      const fields = expandWord(r.target, this.expandEnv());
      if (fields.length !== 1) {
        throw new RedirectError(`${wordSource(r.target)}: ambiguous redirect`);
      }
      const target = fields[0];

      if (r.op === '>&') {
        let sink: OutStream;
        if (target === '1') sink = out.out;
        else if (target === '2') sink = out.err;
        else if (target === '-') sink = nullSink;
        else throw new RedirectError(`${target}: ambiguous redirect`);
        this.setOut(out, r.fd, sink);
        continue;
      }

      if (r.fd > 2) throw new RedirectError(`${r.fd}: Bad file descriptor`);
      const isNull = this.vfs.resolve(target) === DEV_NULL;

      if (r.op === '<') {
        if (r.fd !== 0) throw new RedirectError(`${r.fd}: Bad file descriptor`);
        out.stdin = isNull ? '' : this.guard(() => this.vfs.readFile(target));
        continue;
      }

      if (r.fd === 0) throw new RedirectError(`${r.fd}: Bad file descriptor`);
      if (isNull) {
        this.setOut(out, r.fd, nullSink);
        continue;
      }
      this.guard(() =>
        r.op === '>' ? this.vfs.writeFile(target, '') : this.vfs.appendFile(target, ''),
      );
      this.setOut(out, r.fd, new FileSink(this.vfs, this.vfs.resolve(target)));
    }
    return out;
  }

  private setOut(fds: Fds, fd: number, sink: OutStream) {
    if (fd === 1) fds.out = sink;
    else if (fd === 2) fds.err = sink;
    else throw new RedirectError(`${fd}: Bad file descriptor`);
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof VfsError) throw new RedirectError(e.message);
      throw e;
    }
  }
}

/** The word roughly as typed, for error messages (`$MANY`, `*.txt`). */
function wordSource(w: Word): string {
  return w.parts.map((p) => (p.kind === 'var' ? `$${p.name}` : p.text)).join('');
}

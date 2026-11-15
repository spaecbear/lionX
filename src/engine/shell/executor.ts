import { VfsError, type Vfs } from '../vfs';
import type { Command, CommandRegistry, IO, OutStream, ShellContext, Tty } from '../commands/types';
import type {
  AndOr,
  ForCommand,
  IfCommand,
  ListEntry,
  Pipeline,
  Redirect,
  SimpleCommand,
  Word,
} from './ast';
import { expandWord, expandWordToString, type ExpandEnv } from './expand';
import { JobTable, ProcessTable } from '../processes';
import { ShellSyntaxError, tokenize, type Token } from './lexer';
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
  /** The world's processes (enables real background jobs). */
  processes?: ProcessTable;
  /** Called (after the command finishes) when the player runs `exit` at the prompt. */
  onExit?: () => void;
  /** Notified after every simple command runs (inside pipelines too), with its own status. */
  onCommandRun?: (name: string, args: string[], status: number) => void;
}

/** Commands built into the shell: always found, never looked up on PATH. */
export const BUILTINS = new Set([
  'cd',
  'pwd',
  'echo',
  'export',
  'alias',
  'unalias',
  'exit',
  'kill',
  'jobs',
  'fg',
  'bg',
  'source',
  '.',
  'type',
  'true',
  'false',
  'hint',
  'status',
  'duty',
  'quests',
  'settings',
]);

/** First line of a spell's file in /usr/bin: which built-in command it runs. */
export const SPELL_MARKER = 'LEXICON-SPELL ';

/** Thrown by `exit` inside a script to end just the script. */
export class ScriptExit extends Error {
  constructor(readonly status: number) {
    super('exit');
  }
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
  onCommandRun?: (name: string, args: string[], status: number) => void;
  /** Where command output goes when not redirected. The UI may swap these. */
  terminal: ShellOptions['terminal'];
  private nextJob = 1;
  private nextPid = 1000;
  processes?: ProcessTable;
  jobs?: JobTable;
  shellPid?: number;
  onExit?: () => void;
  readonly aliases = new Map<string, string>();
  readonly exported = new Set<string>();
  private scriptDepth = 0;
  /** While sourcing trusted startup files, spells are not locked. */
  private trusted = false;

  constructor(opts: ShellOptions) {
    this.vfs = opts.vfs;
    this.registry = opts.registry;
    this.terminal = opts.terminal;
    this.shellName = opts.shellName ?? 'bash';
    this.env = new Map(Object.entries(opts.env ?? {}));
    for (const k of this.env.keys()) this.exported.add(k);
    this.tty = opts.tty;
    this.isUnlocked = opts.isUnlocked ?? (() => true);
    this.onCommandRun = opts.onCommandRun;
    if (opts.processes) this.attachProcesses(opts.processes);
    this.onExit = opts.onExit;
    if (!this.env.has('HOME')) this.env.set('HOME', this.vfs.home);
    this.exported.add('HOME');
  }

  /**
   * Give the shell a process table: it gets an init and a bash process, and
   * `&` starts real background jobs for commands that support it.
   */
  attachProcesses(table: ProcessTable): void {
    this.processes = table;
    this.jobs = new JobTable(table);
    const user = this.vfs.credentials.user;
    if (!table.get(1)) table.spawn({ pid: 1, name: 'init', args: '/sbin/init', user: 'root' });
    const bash = table.list().find((p) => p.name === 'bash' && p.user === user);
    this.shellPid = (bash ?? table.spawn({ name: 'bash', args: '-bash', user, tty: 'pts/0' })).pid;
  }

  /** The context commands receive (variables may be overridden for one command). */
  context(env = this.env): ShellContext {
    return {
      vfs: this.vfs,
      env,
      registry: this.registry,
      shellName: this.shellName,
      processes: this.processes,
      jobs: this.jobs,
      shellPid: this.shellPid,
      exec: {
        source: (path, io) => this.source(path, io),
        aliases: this.aliases,
        exported: this.exported,
        lookup: (name) => this.lookup(name),
        inScript: this.scriptDepth > 0,
        requestExit: () => {
          if (this.onExit) queueMicrotask(this.onExit);
        },
      },
    };
  }

  /** How a command name resolves (for type, which, and running). */
  lookup(name: string): ReturnType<NonNullable<ShellContext['exec']>['lookup']> {
    if (this.aliases.has(name)) return { kind: 'alias', value: this.aliases.get(name)! };
    if (BUILTINS.has(name) && this.registry.has(name)) return { kind: 'builtin' };
    const path = this.findOnPath(name);
    return path ? { kind: 'file', path } : { kind: 'none' };
  }

  /** The first executable file called `name` in the PATH directories (or null). */
  private findOnPath(name: string): string | null {
    const PATH = this.env.get('PATH');
    if (PATH === undefined || name.includes('/')) return null;
    for (const dir of PATH.split(':')) {
      const candidate = `${dir || '.'}/${name}`;
      if (this.vfs.isFile(candidate) && this.vfs.access(candidate, 'x'))
        return this.vfs.resolve(candidate);
    }
    return null;
  }

  /** Run a file's commands in this shell, like `source` or `.`. */
  async source(path: string, io: IO, opts: { trusted?: boolean } = {}): Promise<number> {
    if (opts.trusted) {
      // Startup files: other commands wait until this is done, so trust never leaks to them.
      const done = this.sourceTrusted(path, io);
      this.startup = done.then(
        () => undefined,
        () => undefined,
      );
      return done;
    }
    const text = this.vfs.readFile(path);
    const saved = this.terminal;
    const wasTrusted = this.trusted;
    const mine = { stdout: io.stdout, stderr: io.stderr };
    this.terminal = mine;
    if (opts.trusted) this.trusted = true;
    try {
      return await this.run(text.replace(/^#![^\n]*\n/, ''), { nested: true });
    } finally {
      if (this.terminal === mine) this.terminal = saved;
      this.trusted = wasTrusted;
    }
  }

  private startup: Promise<void> | null = null;

  /** Read a startup file quietly (it is not the player reading) and run it trusted. */
  private async sourceTrusted(path: string, io: IO): Promise<number> {
    const text = this.vfs.isFile(path) ? this.vfs.readFileQuietly(path) : '';
    const saved = this.terminal;
    const mine = { stdout: io.stdout, stderr: io.stderr };
    this.terminal = mine;
    this.trusted = true;
    try {
      return await this.run(text.replace(/^#![^\n]*\n/, ''), { nested: true });
    } finally {
      if (this.terminal === mine) this.terminal = saved;
      this.trusted = false;
      this.startup = null;
    }
  }

  /**
   * Run a script file as a child: its own variables (with $0, $1.., $#, $@),
   * its own working directory, and `exit` ends only the script.
   */
  private async runScript(path: string, args: string[], io: IO): Promise<number> {
    const text = this.vfs.readFile(path);
    const savedEnv = new Map(this.env);
    const savedCwd = this.vfs.cwd;
    const savedTerminal = this.terminal;
    const savedStatus = this.lastStatus;
    this.env.set('0', path);
    for (let i = 1; i <= 9; i++) this.env.delete(String(i));
    args.forEach((a, i) => this.env.set(String(i + 1), a));
    this.env.set('#', String(args.length));
    this.env.set('@', args.join(' '));
    this.env.set('*', args.join(' '));
    const mine = { stdout: io.stdout, stderr: io.stderr };
    this.terminal = mine;
    this.scriptDepth++;
    try {
      return await this.run(text.replace(/^#![^\n]*\n/, ''), { nested: true });
    } catch (e) {
      if (e instanceof ScriptExit) return e.status;
      throw e;
    } finally {
      this.scriptDepth--;
      if (this.terminal === mine) this.terminal = savedTerminal;
      this.env.clear();
      for (const [k, v] of savedEnv) this.env.set(k, v);
      try {
        this.vfs.chdir(savedCwd);
      } catch {
        // The script removed or sealed where we stood; stay where it left us.
      }
      void savedStatus;
    }
  }

  /** Start `cmd &` as a real background job if the command can run as a process. */
  private async tryBackground(node: AndOr): Promise<boolean> {
    if (!this.processes || !this.jobs || node.rest.length || node.first.commands.length !== 1)
      return false;
    const cmd = node.first.commands[0];
    if (cmd.type !== 'command' || cmd.redirects.length || cmd.assignments.length) return false;
    const argv = cmd.words.flatMap((w) => expandWord(w, this.expandEnv()));
    const command = argv.length ? this.registry.get(argv[0]) : undefined;
    if (!command?.background || !this.isUnlocked(command)) return false;
    const spec = command.background(argv.slice(1), this.context());
    if (typeof spec === 'string') {
      this.terminal.stderr.write(spec);
      this.onCommandRun?.(argv[0], argv.slice(1), 1);
      this.lastStatus = 0;
      return true;
    }
    const p = this.processes.spawn({
      ...spec,
      user: this.vfs.credentials.user,
      parent: this.shellPid,
      tty: 'pts/0',
    });
    const job = this.jobs.add(p.pid, argv.join(' '));
    this.terminal.stderr.write(`[${job.id}] ${p.pid}\n`);
    this.onCommandRun?.(argv[0], argv.slice(1), 0);
    this.lastStatus = 0;
    return true;
  }

  /** Run one line of input. Returns the exit status (also stored in `$?`). */
  async run(line: string, opts: { nested?: boolean } = {}): Promise<number> {
    if (!opts.nested && this.startup) await this.startup;
    let script;
    try {
      script = parse(line);
    } catch (e) {
      if (!(e instanceof ShellSyntaxError)) throw e;
      this.terminal.stderr.write(`${this.shellName}: ${e.message}\n`);
      return (this.lastStatus = 2);
    }
    for (const entry of script.entries) {
      if (entry.background && (await this.tryBackground(entry.node))) {
        continue;
      } else if (entry.background) {
        const job = this.nextJob++;
        this.terminal.stderr.write(`[${job}] ${this.nextPid++}\n`);
        await this.runAndOr(entry.node);
        this.lastStatus = 0;
      } else {
        await this.runAndOr(entry.node);
      }
    }
    // Bash reports background jobs that finished, before the next prompt.
    const report = opts.nested ? '' : this.jobs?.report();
    if (report) this.terminal.stdout.write(report);
    return this.lastStatus;
  }

  private async runAndOr(node: AndOr): Promise<void> {
    this.lastStatus = await this.runPipeline(node.first);
    for (const { op, pipeline } of node.rest) {
      if ((op === '&&') === (this.lastStatus === 0)) {
        this.lastStatus = await this.runPipeline(pipeline);
      }
    }
    // Report && and || as spells too, so lessons and mastery can see them.
    // The chain itself worked, whatever its parts reported.
    for (const op of new Set(node.rest.map((r) => r.op))) this.onCommandRun?.(op, [], 0);
  }

  private async runPipeline(p: Pipeline): Promise<number> {
    let input: string | null = null;
    let status = 0;
    for (let i = 0; i < p.commands.length; i++) {
      const last = i === p.commands.length - 1;
      const pipe = last ? null : new BufferSink();
      const c = p.commands[i];
      const fds = { stdin: input, out: pipe ?? this.terminal.stdout, err: this.terminal.stderr };
      status =
        c.type === 'command' ? await this.runCommand(c, fds) : await this.runCompound(c, fds);
      input = pipe ? pipe.text : null;
    }
    if (p.commands.length > 1) this.onCommandRun?.('|', [], 0);
    return status;
  }

  /** Run a list of commands (a loop body, an if branch). */
  private async runList(entries: ListEntry[]): Promise<number> {
    for (const entry of entries) {
      if (entry.background && (await this.tryBackground(entry.node))) continue;
      await this.runAndOr(entry.node);
    }
    return this.lastStatus;
  }

  /** for and if. Their output goes wherever the pipeline sends it. */
  private async runCompound(cmd: ForCommand | IfCommand, fds: Fds): Promise<number> {
    const saved = this.terminal;
    const mine = { stdout: fds.out, stderr: fds.err };
    this.terminal = mine;
    try {
      if (cmd.type === 'for') {
        const values =
          cmd.words === null
            ? (this.env.get('@') ?? '').split(' ').filter(Boolean)
            : cmd.words.flatMap((w) => expandWord(w, this.expandEnv()));
        this.lastStatus = 0;
        for (const v of values) {
          this.env.set(cmd.name, v);
          await this.runList(cmd.body);
        }
        return this.lastStatus;
      }
      for (const branch of cmd.branches) {
        await this.runList(branch.cond);
        if (this.lastStatus === 0) return this.runList(branch.body);
      }
      if (cmd.elseBody) return this.runList(cmd.elseBody);
      return (this.lastStatus = 0);
    } finally {
      if (this.terminal === mine) this.terminal = saved;
    }
  }

  private expandEnv(env = this.env): ExpandEnv {
    return { vfs: this.vfs, env, lastStatus: this.lastStatus };
  }

  private async runCommand(cmd: SimpleCommand, fds: Fds): Promise<number> {
    cmd = this.expandAlias(cmd);
    const ex = this.expandEnv();
    const argv = cmd.words.flatMap((w) => expandWord(w, ex));
    const status = await this.runExpanded(cmd, argv, fds);
    // Commands inside scripts and startup files are not the player's own casts.
    if (this.scriptDepth === 0 && !this.trusted) {
      if (argv.length) this.onCommandRun?.(argv[0], argv.slice(1), status);
      // `sudo chown ...` is a cast of chown too.
      if (argv[0] === 'sudo') {
        let i = 1;
        while (i < argv.length && argv[i].startsWith('-')) i += argv[i] === '-u' ? 2 : 1;
        if (i < argv.length) this.onCommandRun?.(argv[i], argv.slice(i + 1), status);
      }
      // A redirect succeeded if it was applied, even when the command itself then failed.
      for (const op of redirectSpells(cmd))
        this.onCommandRun?.(op, [], this.redirectFailed ? 1 : 0);
    }
    return status;
  }

  /** Replace the command name with its alias, if it has one (one level, like Bash). */
  private expandAlias(cmd: SimpleCommand): SimpleCommand {
    const first = cmd.words[0]?.parts;
    if (!first || first.length !== 1 || first[0].kind !== 'lit' || first[0].quoted) return cmd;
    const value = this.aliases.get(first[0].text);
    if (value === undefined) return cmd;
    const replacement = tokenize(value)
      .filter((t): t is Extract<Token, { type: 'word' }> => t.type === 'word')
      .map((t) => ({ parts: t.parts }));
    return { ...cmd, words: [...replacement, ...cmd.words.slice(1)] };
  }

  private redirectFailed = false;

  private async runExpanded(cmd: SimpleCommand, argv: string[], fds: Fds): Promise<number> {
    this.redirectFailed = false;
    const ex = this.expandEnv();
    const assigned = cmd.assignments.map((a) => [a.name, expandWordToString(a.value, ex)] as const);

    try {
      fds = this.applyRedirects(cmd.redirects, fds);
    } catch (e) {
      if (e instanceof RedirectError) {
        this.redirectFailed = true;
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
    const io0: IO = {
      stdin: fds.stdin ?? '',
      stdinIsTerminal: fds.stdin === null,
      stdout: fds.out,
      stderr: fds.err,
      stdoutIsTerminal: fds.out === this.terminal.stdout && this.tty !== undefined,
    };
    // Resolve the name: builtins, then PATH (when set), else the spell registry directly.
    let command =
      BUILTINS.has(name) || this.env.get('PATH') === undefined
        ? this.registry.get(name)
        : undefined;
    if (!command && (name.includes('/') || this.env.get('PATH') !== undefined)) {
      const path = name.includes('/') ? name : this.findOnPath(name);
      if (path === null) {
        fds.err.write(`${this.shellName}: ${name}: command not found\n`);
        return 127;
      }
      if (!this.vfs.exists(path)) {
        fds.err.write(`${this.shellName}: ${name}: No such file or directory\n`);
        return 127;
      }
      if (this.vfs.isDir(path)) {
        fds.err.write(`${this.shellName}: ${name}: Is a directory\n`);
        return 126;
      }
      if (!this.vfs.access(path, 'x') || !this.vfs.access(path, 'r')) {
        fds.err.write(`${this.shellName}: ${name}: Permission denied\n`);
        return 126;
      }
      const head = this.vfs.readFileQuietly(path).split('\n')[0];
      if (head.startsWith(SPELL_MARKER)) {
        command = this.registry.get(head.slice(SPELL_MARKER.length).trim());
      } else {
        if (io0.stdoutIsTerminal && this.tty) io0.tty = this.tty;
        return this.runScript(path, args, io0);
      }
    }
    if (!command) {
      fds.err.write(`${this.shellName}: ${name}: command not found\n`);
      return 127;
    }

    if (!this.trusted && !this.isUnlocked(command)) {
      fds.err.write(`${name}: ${LOCKED_MESSAGE}\n`);
      return 127;
    }

    const env = assigned.length ? new Map([...this.env, ...assigned]) : this.env;
    const ctx: ShellContext = this.context(env);
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
      if (e instanceof ScriptExit) throw e;
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

/** Shell constructs reported as spells (never locked; lessons teach them in the Aqueducts). */
export const CONSTRUCT_SPELLS = ['|', '>', '>>', '<', '2>', '2>>', '&&', '||'];

/** The redirection "spells" a command used: >, >>, <, 2>, 2>> (and 2>&1 counts as 2>). */
function redirectSpells(cmd: SimpleCommand): string[] {
  const out = new Set<string>();
  for (const r of cmd.redirects) {
    if (r.op === '<') out.add('<');
    else if (r.op === '>&') {
      if (r.fd === 2) out.add('2>');
    } else out.add(r.fd === 2 ? (r.op === '>>' ? '2>>' : '2>') : r.op);
  }
  return [...out];
}

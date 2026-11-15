import {
  formatJob,
  parseSignal,
  SIGNALS,
  type Proc,
  type ProcessTable,
  type Signal,
} from '../processes';
import type { IO, ShellContext } from './types';
import { defineCommand, errPrefix, helpText, manPageFor } from './util';

const POLL_MS = 200;

function needTable(name: string, io: IO, ctx: ShellContext): ProcessTable | null {
  if (ctx.processes) return ctx.processes;
  io.stderr.write(`${name}: the stacks are quiet; there are no spirits to see yet\n`);
  return null;
}

/** "00:00:07" style CPU time, from a process's share and age. */
function cpuTime(p: Proc, now: number, short = false): string {
  const secs = Math.floor(((now - p.started) / 1000) * (p.cpu / 100));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return short ? `${h * 60 + m}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** procps shows at most 8 characters of a user name, marking cut names with +. */
function psUser(u: string): string {
  return (u.length > 8 ? u.slice(0, 7) + '+' : u).padEnd(8);
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Wait for a foreground process to finish. Ctrl+C interrupts it; Ctrl+Z
 * stops it and makes it a job. Without a terminal, timed processes are
 * simply allowed to finish (time passes instantly).
 */
async function waitForeground(
  p: Proc,
  command: string,
  io: IO,
  ctx: ShellContext,
): Promise<number> {
  const table = ctx.processes!;
  const user = ctx.vfs.credentials.user;
  if (!io.tty) {
    if (p.endsAt !== null) table.remove(p.pid);
    return 0;
  }
  for (;;) {
    if (!table.get(p.pid)) return 0;
    const key = io.tty.pollKey ? await io.tty.pollKey(POLL_MS) : await io.tty.readKey();
    if (key === '\x03') {
      table.signal(p.pid, 'INT', 'root');
      io.stdout.write('^C\n');
      return 130;
    }
    if (key === '\x1a') {
      table.signal(p.pid, 'STOP', user);
      const job = ctx.jobs!.jobs.find((j) => j.pid === p.pid) ?? ctx.jobs!.add(p.pid, command);
      io.stdout.write('^Z\n' + formatJob(job, 'Stopped', '+'));
      return 148;
    }
  }
}

function parseDuration(args: string[]): number | string {
  if (args.length === 0)
    return "sleep: missing operand\nTry 'sleep --help' for more information.\n";
  let total = 0;
  for (const a of args) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(a);
    if (!m)
      return `sleep: invalid time interval '${a}'\nTry 'sleep --help' for more information.\n`;
    total +=
      Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd'];
  }
  return total * 1000;
}

const sleepInner = defineCommand({
  name: 'sleep',
  unlockedInAct: 7,
  options: {},
  async run(o, io, ctx) {
    const ms = parseDuration(o.operands);
    if (typeof ms === 'string') {
      io.stderr.write(ms);
      return 1;
    }
    if (!ctx.processes) return 0;
    const p = ctx.processes.spawn({
      name: 'sleep',
      args: `sleep ${o.operands.join(' ')}`,
      user: ctx.vfs.credentials.user,
      parent: ctx.shellPid,
      tty: 'pts/0',
      durationMs: ms,
    });
    return waitForeground(p, `sleep ${o.operands.join(' ')}`, io, ctx);
  },
});

export const sleep = {
  ...sleepInner,
  background(args: string[]) {
    const ms = parseDuration(args);
    if (typeof ms === 'string') return ms;
    return { name: 'sleep', args: `sleep ${args.join(' ')}`, user: '', durationMs: ms };
  },
};

// --------------------------------------------------------------------- ps

export const ps = defineCommand({
  name: 'ps',
  unlockedInAct: 7,
  options: { flags: 'eAfu', stopAtOperand: false },
  run(o, io, ctx) {
    const table = needTable('ps', io, ctx);
    if (!table) return 1;
    // BSD style: `ps aux` (no dash) arrives as an operand.
    const bsd = o.operands.join('');
    const all = o.has('e') || o.has('A') || /a/.test(bsd) || /x/.test(bsd);
    const self = table.spawn({
      name: 'ps',
      args: ['ps', ...(o.operands.length ? o.operands : o.flags.map((f) => '-' + f))].join(' '),
      user: ctx.vfs.credentials.user,
      parent: ctx.shellPid,
      tty: 'pts/0',
    });
    try {
      const now = ctx.vfs.now();
      const procs = table
        .list()
        .filter((p) => all || (p.tty === 'pts/0' && p.user === ctx.vfs.credentials.user));
      let out = '';
      if (/u/.test(bsd)) {
        out += 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
        for (const p of procs) {
          out += `${psUser(p.user)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(Math.round(p.mem * 8000 + 4000)).padStart(6)} ${String(Math.round(p.mem * 3000 + 1000)).padStart(5)} ${p.tty.padEnd(8)} ${p.state.padEnd(4)} ${clock(p.started)} ${cpuTime(p, now, true).padStart(6)} ${p.args}\n`;
        }
      } else if (o.has('f')) {
        out += 'UID          PID    PPID  C STIME TTY          TIME CMD\n';
        for (const p of procs) {
          out += `${psUser(p.user)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)} ${String(Math.min(99, Math.round(p.cpu))).padStart(2)} ${clock(p.started)} ${p.tty.padEnd(8)} ${cpuTime(p, now)} ${p.args}\n`;
        }
      } else {
        out += '    PID TTY          TIME CMD\n';
        for (const p of procs)
          out += `${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} ${cpuTime(p, now)} ${p.name}\n`;
      }
      io.stdout.write(out);
      return 0;
    } finally {
      table.remove(self.pid);
    }
  },
});

// -------------------------------------------------------------------- top

function topScreen(table: ProcessTable, now: number, rows: number): string {
  const procs = table.list().sort((a, b) => b.cpu - a.cpu || a.pid - b.pid);
  const running = procs.filter((p) => p.state === 'R').length;
  const stopped = procs.filter((p) => p.state === 'T').length;
  const cpu = Math.min(
    100,
    procs.reduce((n, p) => n + (p.state === 'T' ? 0 : p.cpu), 0),
  );
  let out = `top - ${clock(now)}:00 up 1 day,  1 user,  load average: ${(cpu / 100).toFixed(2)}, ${(cpu / 120).toFixed(2)}, ${(cpu / 150).toFixed(2)}\n`;
  out += `Tasks: ${procs.length} total, ${running} running, ${procs.length - running - stopped} sleeping, ${stopped} stopped, 0 zombie\n`;
  out += `%Cpu(s): ${cpu.toFixed(1)} us,  0.0 sy,  0.0 ni, ${(100 - cpu).toFixed(1)} id\n\n`;
  out += '    PID USER      PR  NI    VIRT    RES S  %CPU  %MEM     TIME+ COMMAND\n';
  for (const p of procs.slice(0, Math.max(1, rows - 6))) {
    out += `${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)} ${String(20 + p.nice).padStart(3)} ${String(p.nice).padStart(3)} ${String(Math.round(p.mem * 8000 + 4000)).padStart(7)} ${String(Math.round(p.mem * 3000 + 1000)).padStart(6)} ${p.state} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)} ${cpuTime(p, now, true).padStart(9)} ${p.name}\n`;
  }
  return out;
}

export const top = defineCommand({
  name: 'top',
  unlockedInAct: 7,
  options: {
    flags: 'b',
    withValue: 'n',
    long: { batch: { key: 'b' }, iterations: { key: 'n', takesValue: true } },
  },
  async run(o, io, ctx) {
    const table = needTable('top', io, ctx);
    if (!table) return 1;
    const rows = io.tty?.rows ?? 24;
    if (o.has('b') || !io.tty || !io.stdoutIsTerminal) {
      const n = Number(o.values.get('n') ?? 1) || 1;
      for (let i = 0; i < n; i++)
        io.stdout.write(topScreen(table, ctx.vfs.now(), 40) + (i < n - 1 ? '\n' : ''));
      return 0;
    }
    io.stdout.write('\x1b[?1049h');
    try {
      for (;;) {
        io.stdout.write(
          '\x1b[H\x1b[2J' + topScreen(table, ctx.vfs.now(), rows).replace(/\n/g, '\r\n'),
        );
        const k = io.tty.pollKey ? await io.tty.pollKey(1000) : await io.tty.readKey();
        if (k === 'q' || k === '\x03') break;
      }
    } finally {
      io.stdout.write('\x1b[?1049l');
    }
    return 0;
  },
});

// ------------------------------------------------------------------- kill

/** Bash builtin kill. Accepts pids and %jobs; -SIG, -s SIG, -n NUM, -l. */
export const kill = {
  name: 'kill',
  unlockedInAct: 7,
  manPage: manPageFor('kill'),
  help: helpText('kill'),
  async run(args: string[], io: IO, ctx: ShellContext): Promise<number> {
    const pre = errPrefix('kill', ctx, true);
    const usage = () => {
      io.stderr.write(
        'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n',
      );
      return 2;
    };
    if (args[0] === '--help') {
      io.stdout.write(kill.help);
      return 0;
    }
    let sig: Signal = 'TERM';
    let i = 0;
    if (args[0] === '-l' || args[0] === '-L') {
      if (args[1]) {
        const s = parseSignal(args[1]);
        if (!s) {
          io.stderr.write(`${pre}${args[1]}: invalid signal specification\n`);
          return 1;
        }
        io.stdout.write(
          /^\d+$/.test(args[1]) ? `${s}\n` : `${SIGNALS.find(([, n]) => n === s)![0]}\n`,
        );
        return 0;
      }
      io.stdout.write(
        SIGNALS.map(([n, name]) => `${String(n).padStart(2)}) SIG${name}`).join('\t') + '\n',
      );
      return 0;
    }
    if (args[0] === '-s' || args[0] === '-n') {
      if (!args[1]) return usage();
      const s = parseSignal(args[1]);
      if (!s) {
        io.stderr.write(`${pre}${args[1]}: invalid signal specification\n`);
        return 1;
      }
      sig = s;
      i = 2;
    } else if (args[0]?.startsWith('-') && args[0] !== '--' && args[0].length > 1) {
      const s = parseSignal(args[0].slice(1));
      if (!s) {
        io.stderr.write(`${pre}${args[0].slice(1)}: invalid signal specification\n`);
        return 1;
      }
      sig = s;
      i = 1;
    }
    if (args[i] === '--') i++;
    const targets = args.slice(i);
    if (targets.length === 0) return usage();
    const table = ctx.processes;
    let status = 0;
    for (const t of targets) {
      let pid: number;
      if (t.startsWith('%')) {
        const job = ctx.jobs?.find(t);
        if (!job) {
          io.stderr.write(`${pre}${t}: no such job\n`);
          status = 1;
          continue;
        }
        pid = job.pid;
      } else if (/^-?\d+$/.test(t)) {
        pid = Number(t);
      } else {
        io.stderr.write(`${pre}${t}: arguments must be process or job IDs\n`);
        status = 1;
        continue;
      }
      const r = table ? table.signal(pid, sig, ctx.vfs.credentials.user) : 'ESRCH';
      if (r === 'ESRCH') {
        io.stderr.write(`${pre}(${pid}) - No such process\n`);
        status = 1;
      } else if (r === 'EPERM') {
        io.stderr.write(`${pre}(${pid}) - Operation not permitted\n`);
        status = 1;
      }
    }
    return status;
  },
};

// ------------------------------------------------------------- job control

export const jobs = defineCommand({
  name: 'jobs',
  unlockedInAct: 7,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'lp' },
  run(o, io, ctx) {
    if (!ctx.jobs || !ctx.processes) return 0;
    ctx.processes.tick();
    const list = o.operands.length ? o.operands.map((s) => ctx.jobs!.find(s)) : ctx.jobs.jobs;
    let status = 0;
    o.operands.forEach((s, idx) => {
      if (!list[idx]) {
        io.stderr.write(`${ctx.shellName}: jobs: ${s}: no such job\n`);
        status = 1;
      }
    });
    for (const job of list) {
      if (!job) continue;
      if (o.has('p')) {
        io.stdout.write(`${job.pid}\n`);
        continue;
      }
      const p = ctx.processes.get(job.pid);
      const state = p?.state === 'T' ? 'Stopped' : 'Running';
      const line = formatJob(job, state, ctx.jobs.marker(job), state === 'Running');
      io.stdout.write(o.has('l') ? line.replace(/^(\[\d+\].) {2}/, `$1 ${job.pid} `) : line);
    }
    return status;
  },
});

function jobControl(name: 'fg' | 'bg') {
  return defineCommand({
    name,
    unlockedInAct: 7,
    builtin: true,
    usageStatus: 2,
    options: {},
    async run(o, io, ctx) {
      const spec = o.operands[0];
      const job = ctx.jobs?.find(spec);
      if (!job || !ctx.processes) {
        io.stderr.write(`${ctx.shellName}: ${name}: ${spec ?? 'current'}: no such job\n`);
        return 1;
      }
      const p = ctx.processes.get(job.pid)!;
      if (name === 'bg') {
        if (p.state !== 'T') {
          io.stderr.write(`${ctx.shellName}: bg: job ${job.id} already in background\n`);
          return 0;
        }
        ctx.processes.signal(p.pid, 'CONT', 'root');
        io.stdout.write(`[${job.id}]+ ${job.command} &\n`);
        return 0;
      }
      io.stdout.write(`${job.command}\n`);
      ctx.processes.signal(p.pid, 'CONT', 'root');
      ctx.jobs!.jobs = ctx.jobs!.jobs.filter((j) => j !== job);
      return waitForeground(p, job.command, io, ctx);
    },
  });
}

export const fg = jobControl('fg');
export const bg = jobControl('bg');

// ---------------------------------------------------------- pgrep / pkill

function matching(table: ProcessTable, pattern: string, exact: boolean, user?: string): Proc[] {
  const re = new RegExp(exact ? `^(?:${pattern})$` : pattern);
  return table
    .list()
    .filter(
      (p) =>
        re.test(p.name) &&
        (user === undefined || p.user === user) &&
        p.name !== 'pgrep' &&
        p.name !== 'pkill',
    );
}

export const pgrep = defineCommand({
  name: 'pgrep',
  unlockedInAct: 7,
  options: {
    flags: 'lxa',
    withValue: 'u',
    long: { 'list-name': { key: 'l' }, exact: { key: 'x' } },
  },
  run(o, io, ctx) {
    const table = needTable('pgrep', io, ctx);
    if (!table) return 1;
    if (!o.operands[0]) {
      io.stderr.write(
        "pgrep: no matching criteria specified\nTry `pgrep --help' for more information.\n",
      );
      return 2;
    }
    const found = matching(table, o.operands[0], o.has('x'), o.values.get('u'));
    for (const p of found)
      io.stdout.write(
        o.has('l') ? `${p.pid} ${p.name}\n` : o.has('a') ? `${p.pid} ${p.args}\n` : `${p.pid}\n`,
      );
    return found.length ? 0 : 1;
  },
});

/** pkill: like kill, but by name. Takes -SIG (e.g. -9, -STOP) first, like the real one. */
export const pkill = {
  name: 'pkill',
  unlockedInAct: 7,
  manPage: manPageFor('pkill'),
  help: helpText('pkill'),
  async run(args: string[], io: IO, ctx: ShellContext): Promise<number> {
    if (args[0] === '--help') {
      io.stdout.write(pkill.help);
      return 0;
    }
    let sig: Signal = 'TERM';
    let rest = args;
    if (args[0]?.startsWith('-') && !['-x', '-u'].includes(args[0])) {
      const s = parseSignal(args[0].slice(1));
      if (!s) {
        io.stderr.write(`pkill: invalid signal: ${args[0].slice(1)}\n`);
        return 2;
      }
      sig = s;
      rest = args.slice(1);
    }
    let exact = false;
    let user: string | undefined;
    const ops: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-x') exact = true;
      else if (rest[i] === '-u') user = rest[++i];
      else ops.push(rest[i]);
    }
    const table = needTable('pkill', io, ctx);
    if (!table) return 1;
    if (!ops[0]) {
      io.stderr.write(
        "pkill: no matching criteria specified\nTry `pkill --help' for more information.\n",
      );
      return 2;
    }
    const found = matching(table, ops[0], exact, user);
    let ok = false;
    for (const p of found) {
      const r = table.signal(p.pid, sig, ctx.vfs.credentials.user);
      if (r === 'EPERM')
        io.stderr.write(`pkill: killing pid ${p.pid} failed: Operation not permitted\n`);
      else ok = true;
    }
    return ok ? 0 : 1;
  },
};

// ----------------------------------------------------------------- renice

/**
 * util-linux renice: `renice [-n] PRIORITY [-p] PID...`. Sets niceness, the
 * higher the kinder: a nicer spirit takes less of the Archive's strength.
 */
export const renice = {
  name: 'renice',
  unlockedInAct: 7,
  manPage: manPageFor('renice'),
  help: helpText('renice'),
  async run(argv: string[], io: IO, ctx: ShellContext): Promise<number> {
    if (argv[0] === '--help') {
      io.stdout.write(renice.help);
      return 0;
    }
    const table = needTable('renice', io, ctx);
    if (!table) return 1;
    const args = [...argv];
    if (args[0] === '-n') args.shift();
    const raw = args.shift();
    if (raw === undefined || args.length === 0) {
      io.stderr.write("renice: not enough arguments\nTry 'renice --help' for more information.\n");
      return 1;
    }
    if (!/^[+-]?\d+$/.test(raw)) {
      io.stderr.write(
        `renice: invalid priority '${raw}'\nTry 'renice --help' for more information.\n`,
      );
      return 1;
    }
    let status = 0;
    for (const a of args) {
      if (a === '-p') continue;
      if (!/^\d+$/.test(a)) {
        io.stderr.write(`renice: invalid process ID argument: '${a}'\n`);
        status = 1;
        continue;
      }
      const pid = Number(a);
      const r = table.setPriority(pid, Number(raw), ctx.vfs.credentials.user);
      if (r.result === 'ESRCH') {
        io.stderr.write(
          `renice: failed to get priority for ${pid} (process ID): No such process\n`,
        );
        status = 1;
      } else if (r.result !== 'ok') {
        io.stderr.write(
          `renice: failed to set priority for ${pid} (process ID): ${r.result === 'EPERM' ? 'Operation not permitted' : 'Permission denied'}\n`,
        );
        status = 1;
      } else {
        const now = table.get(pid)!.nice;
        io.stdout.write(`${pid} (process ID) old priority ${r.old}, new priority ${now}\n`);
      }
    }
    return status;
  },
};

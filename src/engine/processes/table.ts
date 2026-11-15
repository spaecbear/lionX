/**
 * The Archive's process table: every spirit at work, plus the player's own
 * jobs. Time comes from the world clock. Signals follow Unix rules closely
 * enough that ps, kill, jobs, fg, and bg behave as on a real system.
 */

export type ProcState = 'R' | 'S' | 'T';

export type Signal = 'HUP' | 'INT' | 'KILL' | 'TERM' | 'STOP' | 'CONT' | 'TSTP';

/** Signal numbers and names as `kill -l` lists them (the common ones). */
export const SIGNALS: [number, Signal][] = [
  [1, 'HUP'],
  [2, 'INT'],
  [9, 'KILL'],
  [15, 'TERM'],
  [18, 'CONT'],
  [19, 'STOP'],
  [20, 'TSTP'],
];

export function parseSignal(spec: string): Signal | null {
  const s = spec.toUpperCase().replace(/^SIG/, '');
  if (/^\d+$/.test(s)) return SIGNALS.find(([n]) => n === Number(s))?.[1] ?? null;
  return SIGNALS.find(([, name]) => name === s)?.[1] ?? null;
}

export interface ProcSpec {
  name: string;
  /** Full command line, as ps aux shows it. Defaults to the name. */
  args?: string;
  user: string;
  pid?: number;
  /** Parent process name (resolved when spawned) or pid. */
  parent?: string | number;
  cpu?: number;
  mem?: number;
  /** Ignores TERM, INT, and HUP: only KILL ends it. */
  ignoresTerm?: boolean;
  /** When this process's child dies, it spawns a replacement (while it is not stopped). */
  respawnsChildren?: boolean;
  /** Comes back by itself shortly after being killed (as if started by cron). */
  immortal?: boolean;
  /** Drawn drifting across the screen while it runs. */
  spirit?: string;
  /** Ends by itself after this many ms (sleep). */
  durationMs?: number;
  /** The terminal it belongs to: pts/0 for the player's jobs, ? for daemons and spirits. */
  tty?: string;
  /** Remove any process of the same name first (used when content wakes a fresh one). */
  replace?: boolean;
}

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  args: string;
  user: string;
  state: ProcState;
  cpu: number;
  mem: number;
  started: number;
  /** World time when it finishes by itself; null means never. */
  endsAt: number | null;
  /** Remaining run time while stopped (sleep pauses when stopped). */
  remaining: number | null;
  ignoresTerm: boolean;
  respawnsChildren: boolean;
  immortal: boolean;
  spirit: string | null;
  tty: string;
}

export interface TableSnapshot {
  procs: Proc[];
  nextPid: number;
  /** Respawns waiting to happen: spec and when. */
  pending: { spec: ProcSpec; at: number }[];
}

export type SignalResult = 'ok' | 'ESRCH' | 'EPERM';

/** How long an immortal process stays dead before it returns. */
export const RESPAWN_DELAY_MS = 30_000;

export class ProcessTable {
  private procs = new Map<number, Proc>();
  private nextPid = 2000;
  private pending: { spec: ProcSpec; at: number }[] = [];
  /**
   * Consulted when an immortal process is due to return: return false to keep
   * it gone (the game ties this to the owner's crontab).
   */
  respawnGuard?: (spec: ProcSpec) => boolean;
  /** Notified when a process ends (pid, how). */

  onExit?: (p: Proc, how: 'done' | 'killed') => void;

  constructor(private now: () => number) {}

  spawn(spec: ProcSpec): Proc {
    if (spec.replace)
      for (const old of [...this.procs.values()])
        if (old.name === spec.name) this.procs.delete(old.pid);
    let pid = spec.pid ?? this.nextPid++;
    while (this.procs.has(pid)) pid = this.nextPid++;
    if (spec.pid !== undefined && spec.pid >= this.nextPid) this.nextPid = spec.pid + 1;
    const parent =
      typeof spec.parent === 'number'
        ? spec.parent
        : spec.parent
          ? ([...this.procs.values()].find((p) => p.name === spec.parent)?.pid ?? 1)
          : 1;
    const t = this.now();
    const p: Proc = {
      pid,
      ppid: parent,
      name: spec.name,
      args: spec.args ?? spec.name,
      user: spec.user,
      state: spec.cpu && spec.cpu > 20 ? 'R' : 'S',
      cpu: spec.cpu ?? 0,
      mem: spec.mem ?? 0.1,
      started: t,
      endsAt: spec.durationMs !== undefined ? t + spec.durationMs : null,
      remaining: null,
      ignoresTerm: !!spec.ignoresTerm,
      respawnsChildren: !!spec.respawnsChildren,
      immortal: !!spec.immortal,
      spirit: spec.spirit ?? null,
      tty: spec.tty ?? '?',
    };
    this.procs.set(pid, p);
    return p;
  }

  /** Advance to the present: finish timed processes, bring back respawns. */
  tick(): void {
    const t = this.now();
    for (const p of [...this.procs.values()]) {
      if (p.state !== 'T' && p.endsAt !== null && p.endsAt <= t) this.end(p, 'done');
    }
    const due = this.pending.filter((r) => r.at <= t);
    this.pending = this.pending.filter((r) => r.at > t);
    for (const r of due)
      if (!this.respawnGuard || this.respawnGuard(r.spec))
        this.spawn({ ...r.spec, pid: undefined });
  }

  list(): Proc[] {
    this.tick();
    return [...this.procs.values()].sort((a, b) => a.pid - b.pid);
  }

  get(pid: number): Proc | undefined {
    this.tick();
    return this.procs.get(pid);
  }

  byName(name: string): Proc[] {
    return this.list().filter((p) => p.name === name);
  }

  /** Names of everything alive (running or stopped), for goals. */
  names(): string[] {
    return this.list().map((p) => p.name);
  }

  /** Send a signal as `user`. Root may signal anything; others only their own processes. */
  signal(pid: number, sig: Signal, user: string): SignalResult {
    this.tick();
    const p = this.procs.get(pid);
    if (!p) return 'ESRCH';
    if (user !== 'root' && user !== p.user) return 'EPERM';
    switch (sig) {
      case 'STOP':
      case 'TSTP':
        if (p.state !== 'T') {
          if (p.endsAt !== null) p.remaining = Math.max(0, p.endsAt - this.now());
          p.state = 'T';
        }
        return 'ok';
      case 'CONT':
        if (p.state === 'T') {
          p.state = p.cpu > 20 ? 'R' : 'S';
          if (p.remaining !== null) {
            p.endsAt = this.now() + p.remaining;
            p.remaining = null;
          }
        }
        return 'ok';
      case 'KILL':
        this.end(p, 'killed');
        return 'ok';
      default:
        if (!p.ignoresTerm) this.end(p, 'killed');
        return 'ok';
    }
  }

  private end(p: Proc, how: 'done' | 'killed') {
    this.procs.delete(p.pid);
    this.onExit?.(p, how);
    const spec: ProcSpec = {
      name: p.name,
      args: p.args,
      user: p.user,
      parent: p.ppid,
      cpu: p.cpu,
      mem: p.mem,
      ignoresTerm: p.ignoresTerm,
      respawnsChildren: p.respawnsChildren,
      immortal: p.immortal,
      spirit: p.spirit ?? undefined,
      tty: p.tty,
    };
    if (how === 'killed' && p.immortal) {
      this.pending.push({ spec, at: this.now() + RESPAWN_DELAY_MS });
      return;
    }
    // A running parent that guards its children replaces them at once.
    const parent = this.procs.get(p.ppid);
    if (how === 'killed' && parent && parent.respawnsChildren && parent.state !== 'T') {
      this.spawn({ ...spec, parent: parent.pid });
    }
    // Orphans are adopted by process 1.
    for (const child of this.procs.values()) if (child.ppid === p.pid) child.ppid = 1;
  }

  /** Remove a process quietly (no respawn): cleanup between duties. */
  remove(pid: number): void {
    this.procs.delete(pid);
  }

  /** Cancel scheduled returns (used when the source of respawning is removed, like a cron entry). */
  cancelRespawn(name: string): void {
    this.pending = this.pending.filter((r) => r.spec.name !== name);
  }

  snapshot(): TableSnapshot {
    return structuredClone({
      procs: [...this.procs.values()],
      nextPid: this.nextPid,
      pending: this.pending,
    });
  }

  static load(s: TableSnapshot, now: () => number): ProcessTable {
    const t = new ProcessTable(now);
    for (const p of s.procs) t.procs.set(p.pid, { ...p });
    t.nextPid = s.nextPid;
    t.pending = [...s.pending];
    return t;
  }
}

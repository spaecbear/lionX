import type { ProcessTable } from './table';

/** A shell job: a process started with & (or stopped with Ctrl+Z). */
export interface Job {
  id: number;
  pid: number;
  command: string;
}

/** The shell's job list, tied to a process table. */
export class JobTable {
  jobs: Job[] = [];
  /** Jobs that finished since the last report, for the "[1]+ Done" lines Bash prints. */
  private finished: { job: Job; how: 'done' | 'killed' }[] = [];

  constructor(private table: ProcessTable) {
    const prev = table.onExit;
    table.onExit = (p, how) => {
      prev?.(p, how);
      const job = this.jobs.find((j) => j.pid === p.pid);
      if (job) {
        this.jobs = this.jobs.filter((j) => j !== job);
        this.finished.push({ job, how });
      }
    };
  }

  add(pid: number, command: string): Job {
    const id = this.jobs.length ? Math.max(...this.jobs.map((j) => j.id)) + 1 : 1;
    const job = { id, pid, command };
    this.jobs.push(job);
    return job;
  }

  /** %1, %+, %% (current), %- (previous), or a bare number. */
  find(spec: string | undefined): Job | undefined {
    this.table.tick();
    if (this.jobs.length === 0) return undefined;
    if (spec === undefined || spec === '%' || spec === '%%' || spec === '%+')
      return this.jobs[this.jobs.length - 1];
    if (spec === '%-') return this.jobs[this.jobs.length - 2];
    const n = Number(spec.replace(/^%/, ''));
    return this.jobs.find((j) => j.id === n);
  }

  /** Lines like "[1]+  Done                    sleep 5" for jobs that ended since last asked. */
  report(): string {
    this.table.tick();
    const out = this.finished.map(({ job, how }) =>
      formatJob(job, how === 'done' ? 'Done' : 'Terminated', this.marker(job)),
    );
    this.finished = [];
    return out.join('');
  }

  marker(job: Job): string {
    const last = this.jobs[this.jobs.length - 1];
    const prev = this.jobs[this.jobs.length - 2];
    return job === last || !this.jobs.includes(job) ? '+' : job === prev ? '-' : ' ';
  }

  snapshot(): Job[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  restore(jobs: Job[]) {
    this.jobs = jobs.filter((j) => this.table.get(j.pid));
  }
}

/** Bash's job line format: "[1]+  Running                 sleep 100 &". */
export function formatJob(job: Job, state: string, marker: string, background = false): string {
  return `[${job.id}]${marker}  ${state.padEnd(24)}${job.command}${background ? ' &' : ''}\n`;
}

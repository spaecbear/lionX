import { defineCommand, helpText } from '../commands/util';
import type { Glossary } from './explain';
import { masteryPhrase } from '../progression';
import type { LessonRunner } from './runner';

/** `status`: how the apprentice is doing, told as flavor text rather than numbers. */
export function createStatusCommand(getRunner: () => LessonRunner | null) {
  return defineCommand({
    name: 'status',
    unlockedInAct: 0,
    options: {},
    run(_opts, io) {
      const runner = getRunner();
      if (!runner) return 0;
      const p = runner.progress;
      const lines: string[] = [];
      for (const spell of runner.known)
        lines.push(`  ${masteryPhrase(spell, p.mastery[spell] ?? 0)}`);
      if (lines.length === 0) lines.push('  You have not learned any spells yet.');
      lines.push('');
      lines.push(`  Duties done: ${p.dutiesDone}`);
      if (p.lore.length) lines.push(`  Lore fragments found: ${p.lore.length}`);
      lines.push(`  ${runner.statusLine}`);
      const width = io.tty?.cols ?? 80;
      io.stdout.write(lines.map((l) => wrapIndented(l, width)).join('\n') + '\n');
      return 0;
    },
  });
}

/** `duty`: ask Quill for restoration work (or a reminder of the current task). */
export function createDutyCommand(getRunner: () => LessonRunner | null) {
  return defineCommand({
    name: 'duty',
    unlockedInAct: 0,
    options: {},
    run() {
      const runner = getRunner();
      if (runner) runner.queue(runner.requestDuty());
      return 0;
    },
  });
}

/** Word-wrap a line to `width`, keeping its leading indent on continuation lines. */
export function wrapIndented(line: string, width: number, hang?: number): string {
  const first = /^\s*/.exec(line)![0];
  const indent = hang === undefined ? first : ' '.repeat(hang);
  const words = line.trim().split(/\s+/);
  if (line.length <= width || words.length < 2) return line;
  const rows: string[] = [];
  let cur = first;
  for (const w of words) {
    if (cur.trim() && cur.length + 1 + w.length > width) {
      rows.push(cur);
      cur = indent + w;
    } else cur = cur.trim() ? `${cur} ${w}` : cur + w;
  }
  rows.push(cur);
  return rows.join('\n');
}

/** `quests`: the side quests after the main story (still to be written). */
export function createQuestsCommand(getRunner: () => LessonRunner | null, text: string) {
  return defineCommand({
    name: 'quests',
    unlockedInAct: 0,
    options: {},
    run(_o, io) {
      const done = getRunner()?.progress.wingsDone.includes('root');
      io.stdout.write(
        done ? text : 'The side quests open once the Archive is restored. Keep going.\n',
      );
      return 0;
    },
  });
}

/** Spells every apprentice has from the start, for help's last line. */
const HELPERS = ['hint', 'solution', 'status', 'duty', 'help', 'settings'];

/**
 * `help`: every spell you know, what it does, and the flags it takes.
 * `help NAME` shows one spell's usage (like Bash's `help cd`).
 */
export function createHelpCommand(getRunner: () => LessonRunner | null, glossary?: Glossary) {
  return defineCommand({
    name: 'help',
    unlockedInAct: 0,
    options: {},
    run(o, io) {
      const width = io.tty?.cols ?? 80;
      const name = o.operands[0];
      if (name) {
        const text = helpText(name);
        if (!text) {
          io.stderr.write(`help: no help topics match \`${name}'.\n`);
          return 1;
        }
        io.stdout.write(text);
        return 0;
      }
      const runner = getRunner();
      const known = (runner?.known ?? []).filter((s) => /^[a-z]/.test(s));
      const pad = Math.max(...known.map((s) => s.length), 4) + 2;
      const lines: string[] = ['Spells you know:'];
      for (const s of known) {
        const c = glossary?.commands[s];
        lines.push(wrapIndented(`  ${s.padEnd(pad)}${c?.says ?? ''}`, width, pad + 2));
        for (const [flag, info] of Object.entries(c?.flags ?? {})) {
          const says = typeof info === 'string' ? info : info.says;
          const shown = typeof info !== 'string' && info.takes ? `${flag} N` : flag;
          lines.push(wrapIndented(`${' '.repeat(pad + 2)}${shown}  ${says}`, width, pad + 4));
        }
      }
      if (known.length === 0) lines.push('  None yet.');
      lines.push('', `Always at hand: ${HELPERS.join(', ')}.`);
      lines.push('`help NAME` for one spell, `man NAME` for its Grimoire page.');
      io.stdout.write(lines.join('\n') + '\n');
      return 0;
    },
  });
}

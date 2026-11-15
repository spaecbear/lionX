import { defineCommand, helpText } from '../commands/util';
import type { Glossary } from './explain';
import type { Achievement } from '../content';
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
      if (p.achievements?.length)
        lines.push(`  Achievements: ${p.achievements.length} (see achievements)`);
      if (p.secrets?.length)
        lines.push(`  Secrets found: ${p.secrets.length} of ${runner.secretCount}`);
      const toGate = runner.dutiesToGate();
      if (toGate?.length) {
        const most = toGate.reduce((n, x) => n + x.left, 0);
        lines.push(
          `  ${((runner.easy ? runner.lines.untilTrialEasy : runner.lines.untilTrial) ?? 'Next trial: about {n} more dut{s}.').replace('{n}', String(most)).replace('{s}', most === 1 ? 'y' : 'ies')}`,
        );
        lines.push(
          `    Still practicing: ${toGate.map((x) => `${x.spell} (about ${x.left})`).join(', ')}`,
        );
      } else lines.push(`  ${runner.statusLine}`);
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
    run(o, io) {
      const runner = getRunner();
      const [what] = o.operands;
      if (what && what !== 'skip') {
        io.stderr.write(`duty: unknown request '${what}' (try duty, or duty skip)\n`);
        return 1;
      }
      if (runner) runner.queue(what === 'skip' ? runner.skipDuty() : runner.requestDuty());
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
const HELPERS = ['hint', 'solution', 'status', 'duty', 'achievements', 'help', 'settings'];

/**
 * `help`: an index of the spells you know, one line each. The Grimoire (`man`)
 * holds the full pages and flags.
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
      }
      if (known.length === 0) lines.push('  None yet.');
      lines.push('', `Always at hand: ${HELPERS.join(', ')}.`);
      lines.push('Flags, examples and the rest live in the Grimoire: `man NAME`.');
      io.stdout.write(lines.join('\n') + '\n');
      return 0;
    },
  });
}

/** `achievements`: what you have earned, what is left, and ??? for the hidden ones. */
export function createAchievementsCommand(
  getRunner: () => LessonRunner | null,
  list: Achievement[],
) {
  return defineCommand({
    name: 'achievements',
    unlockedInAct: 0,
    options: {},
    run(_o, io) {
      const runner = getRunner();
      if (runner?.progress.storyMode)
        io.stdout.write('Story mode played part of this save, so achievements are off for it.\n\n');
      const earned = runner?.progress.achievements ?? [];
      const width = io.tty?.cols ?? 80;
      const lines = [
        `Achievements: ${earned.filter((id) => list.some((a) => a.id === id)).length} of ${list.length}`,
        '',
      ];
      for (const a of list) {
        const got = earned.includes(a.id);
        if (!got && a.hidden) lines.push('  [ ] ???');
        else lines.push(wrapIndented(`  [${got ? '*' : ' '}] ${a.title}: ${a.says}`, width, 6));
      }
      io.stdout.write(lines.join('\n') + '\n');
      return 0;
    },
  });
}

import { defineCommand } from '../commands/util';
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
export function wrapIndented(line: string, width: number): string {
  const indent = /^\s*/.exec(line)![0];
  const words = line.trim().split(/\s+/);
  if (line.length <= width || words.length < 2) return line;
  const rows: string[] = [];
  let cur = indent;
  for (const w of words) {
    if (cur.trim() && cur.length + 1 + w.length > width) {
      rows.push(cur);
      cur = indent + w;
    } else cur = cur.trim() ? `${cur} ${w}` : indent + w;
  }
  rows.push(cur);
  return rows.join('\n');
}

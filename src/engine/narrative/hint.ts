import { defineCommand } from '../commands/util';
import type { LessonRunner } from './runner';

/** The in-world `hint` spell. Quill's answer is queued as narration, not printed. */
export function createHintCommand(getRunner: () => LessonRunner | null) {
  return defineCommand({
    name: 'hint',
    unlockedInAct: 0,
    options: {},
    run() {
      const runner = getRunner();
      if (runner) runner.queue(runner.hint());
      return 0;
    },
  });
}

/** `solution`: the strongest hint. Quill shows one way and explains every piece. */
export function createSolutionCommand(getRunner: () => LessonRunner | null) {
  return defineCommand({
    name: 'solution',
    unlockedInAct: 0,
    options: {},
    run() {
      const runner = getRunner();
      if (runner) runner.queue(runner.solution());
      return 0;
    },
  });
}

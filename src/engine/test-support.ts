/**
 * Helpers for tests that need the world as it stands partway through the
 * game. Not used by the game itself.
 */
import { loadGameContent } from '../content/game';
import { createRegistry } from './commands';
import type { Wing } from './content';
import { LessonRunner } from './narrative';
import { newProgress } from './progression';
import { Shell } from './shell';
import { applyPatch, buildWorld, type Vfs } from './vfs';

export const content = loadGameContent();

/** Wings in play order, from the first wing along each `next`. */
export function wingChain(): Wing[] {
  const chain: Wing[] = [];
  let w: Wing | undefined = content.wings[content.startWing];
  while (w) {
    chain.push(w);
    w = w.next ? content.wings[w.next] : undefined;
  }
  return chain;
}

/** The world when `wingId` begins: earlier wings' capstones unlocked, this wing's setup applied. */
export function worldFor(wingId: string): Vfs {
  if (wingId === 'lantern-hall') return buildWorld(content.wings['lantern-hall'].world!);
  const chain = wingChain();
  const start = chain[0];
  const vfs = buildWorld(start.world!);
  const user = start.world!.user;
  for (const w of chain) {
    if (w !== start && w.setup) applyPatch(vfs, w.setup, user);
    if (w.id === wingId) return vfs;
    if (w.capstone?.unlocks) applyPatch(vfs, w.capstone.unlocks, user);
  }
  throw new Error(`Wing ${wingId} is not in the chain`);
}

/** A runner standing at the start of `wingId`'s capstone, with a shell wired to it. */
export function atCapstone(wingId: string) {
  const wing = content.wings[wingId];
  const vfs = worldFor(wingId);
  const progress = newProgress(1);
  progress.known = wingChain()
    .slice(0, wingChain().findIndex((w) => w.id === wingId) + 1)
    .flatMap((w) => w.lessons.flatMap((l) => l.spells));
  const runner = new LessonRunner(wing, {
    ...content,
    progress,
    restore: {
      vfs: vfs.serialize(),
      runner: {
        wingId,
        phase: 'capstone',
        lessonIndex: 0,
        stepIndex: 0,
        hintsUsed: 0,
        struggled: false,
        level: 'problem',
        duty: null,
        commands: [],
        reads: [],
      },
    },
  });
  const shell = new Shell({
    vfs: runner.vfs,
    registry: createRegistry(),
    terminal: { stdout: { write() {} }, stderr: { write() {} } },
    onCommandRun: (n, a, s) => runner.recordCommand(n, a, s),
    isUnlocked: (c) => c.unlockedInAct === 0 || runner.knows(c.name),
  });
  const type = async (line: string) => {
    const status = await shell.run(line);
    runner.afterCommand(line, status, '');
    return status;
  };
  return { runner, shell, type };
}

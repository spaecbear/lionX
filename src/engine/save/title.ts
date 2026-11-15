import { defineCommand } from '../commands/util';
import { CommandRegistry } from '../commands/types';
import { formatDate } from '../commands/ls';
import { eraseSlot, readSlot, SLOT_COUNT, type SaveStorage, type SlotRead } from './save';

/** What the title screen needs from the game. */
export interface TitleHost {
  storage: SaveStorage | null;
  /** Start or continue a slot. Called after the current command finishes. */
  play(slot: number): void;
  now(): number;
}

/** One line describing a slot, e.g. "1  lantern-hall, duties, 3 duties done (saved Nov 15 01:20)". */
export function describeSlot(slot: number, read: SlotRead, now: number): string {
  if (read.status === 'empty') return `  ${slot}  (empty)`;
  if (read.status === 'broken') return `  ${slot}  (unreadable: ${read.reason})`;
  const d = read.data;
  const where =
    d.runner.phase === 'free'
      ? 'wandering freely'
      : d.runner.phase === 'lessons'
        ? 'in lessons'
        : d.runner.phase === 'duties'
          ? 'on duty'
          : 'facing the final trial';
  const duties =
    d.progress.dutiesDone === 1 ? '1 duty done' : `${d.progress.dutiesDone} duties done`;
  return `  ${slot}  ${d.runner.wingId}, ${where}, ${duties}  (saved ${formatDate(d.savedAt, now)})`;
}

function slotArg(arg: string | undefined): number | null {
  const n = Number(arg);
  return Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT ? n : null;
}

/**
 * The title screen's spells. The title is a tiny terminal of its own:
 * `slots` lists saves, `play N` starts or continues one, `erase N` clears one.
 */
export function createTitleRegistry(host: TitleHost, help: string): CommandRegistry {
  const listing = () =>
    Array.from({ length: SLOT_COUNT }, (_, i) =>
      describeSlot(i + 1, readSlot(host.storage, i + 1), host.now()),
    ).join('\n') + '\n';

  const slots = defineCommand({
    name: 'slots',
    unlockedInAct: 0,
    options: {},
    run(_o, io) {
      io.stdout.write(listing());
      if (!host.storage)
        io.stdout.write(
          '\n  This browser will not keep saves; progress lasts until you close the page.\n',
        );
      return 0;
    },
  });

  const play = defineCommand({
    name: 'play',
    unlockedInAct: 0,
    options: {},
    run(o, io) {
      const slot = slotArg(o.operands[0]);
      if (slot === null) {
        io.stderr.write(`play: choose a slot from 1 to ${SLOT_COUNT}, like: play 1\n`);
        return 1;
      }
      const read = readSlot(host.storage, slot);
      if (read.status === 'broken') {
        io.stderr.write(
          `play: slot ${slot} cannot be read (${read.reason}). Erase it to start over: erase ${slot}\n`,
        );
        return 1;
      }
      host.play(slot);
      return 0;
    },
  });

  const erase = defineCommand({
    name: 'erase',
    unlockedInAct: 0,
    options: {},
    async run(o, io) {
      const slot = slotArg(o.operands[0]);
      if (slot === null) {
        io.stderr.write(`erase: choose a slot from 1 to ${SLOT_COUNT}, like: erase 2\n`);
        return 1;
      }
      if (readSlot(host.storage, slot).status === 'empty') {
        io.stdout.write(`Slot ${slot} is already empty.\n`);
        return 0;
      }
      if (io.tty) {
        io.stdout.write(`Erase slot ${slot} forever? (y/n) `);
        const answer = await io.tty.readKey();
        io.stdout.write(answer.length === 1 && answer >= ' ' ? answer + '\n' : '\n');
        if (answer.toLowerCase() !== 'y') {
          io.stdout.write('Kept.\n');
          return 1;
        }
      }
      if (!eraseSlot(host.storage, slot)) {
        io.stderr.write(`erase: slot ${slot} could not be erased\n`);
        return 1;
      }
      io.stdout.write(`Slot ${slot} erased.\n`);
      return 0;
    },
  });

  const helpCmd = defineCommand({
    name: 'help',
    unlockedInAct: 0,
    options: {},
    run(_o, io) {
      io.stdout.write(help);
      return 0;
    },
  });

  return new CommandRegistry().register(slots, play, erase, helpCmd);
}

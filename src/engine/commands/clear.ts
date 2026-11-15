import type { Command } from './types';
import manPage from '../../content/grimoire/clear.txt?raw';

/** The escape sequence real `clear` prints: home, erase screen, erase scrollback. */
export const CLEAR_SEQUENCE = '\x1b[H\x1b[2J\x1b[3J';

export const clear: Command = {
  name: 'clear',
  unlockedInAct: 0,
  manPage,
  async run(args, io) {
    if (args.length > 0 && args[0] !== '-x') {
      io.stderr.write(`clear: invalid option -- '${args[0].replace(/^-/, '')}'\n`);
      io.stderr.write('Usage: clear [options]\n');
      return 1;
    }
    io.stdout.write(args[0] === '-x' ? '\x1b[H\x1b[2J' : CLEAR_SEQUENCE);
    return 0;
  },
};

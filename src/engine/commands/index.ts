import { cat } from './cat';
import { cd } from './cd';
import { clear } from './clear';
import { echo } from './echo';
import { head, tail } from './headtail';
import { less } from './less';
import { ls } from './ls';
import { man } from './man';
import { pwd } from './pwd';
import { CommandRegistry } from './types';

export * from './types';
export { cat, cd, clear, echo, head, less, ls, man, pwd, tail };

/** Every command implemented so far. */
export const allCommands = [cat, cd, clear, echo, head, less, ls, man, pwd, tail];

export function createRegistry(): CommandRegistry {
  return new CommandRegistry().register(...allCommands);
}

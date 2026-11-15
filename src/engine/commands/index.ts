import { clear } from './clear';
import { echo } from './echo';
import { CommandRegistry } from './types';

export * from './types';
export { clear, echo };

/** Every command implemented so far. */
export const allCommands = [clear, echo];

export function createRegistry(): CommandRegistry {
  return new CommandRegistry().register(...allCommands);
}

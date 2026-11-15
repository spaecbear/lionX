import { cat } from './cat';
import { cd } from './cd';
import { clear } from './clear';
import { echo } from './echo';
import { cp, mkdir, mv, rm, rmdir, touch } from './fileops';
import { head, tail } from './headtail';
import { less } from './less';
import { ls } from './ls';
import { man } from './man';
import { pwd } from './pwd';
import { CommandRegistry } from './types';

export * from './types';
export { cat, cd, clear, cp, echo, head, less, ls, man, mkdir, mv, pwd, rm, rmdir, tail, touch };

/** Every command implemented so far. */
export const allCommands = [
  cat,
  cd,
  clear,
  cp,
  echo,
  head,
  less,
  ls,
  man,
  mkdir,
  mv,
  pwd,
  rm,
  rmdir,
  tail,
  touch,
];

export function createRegistry(): CommandRegistry {
  return new CommandRegistry().register(...allCommands);
}

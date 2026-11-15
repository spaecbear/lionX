import { cat } from './cat';
import { cd } from './cd';
import { clear } from './clear';
import { echo } from './echo';
import { cp, mkdir, mv, rm, rmdir, touch } from './fileops';
import { head, tail } from './headtail';
import { less } from './less';
import { ls } from './ls';
import { man } from './man';
import { chmod, chown, id, sudo, whoami } from './permops';
import { pwd } from './pwd';
import { find, grep, sort, uniq, wc } from './textops';
import { falseCmd, trueCmd } from './truefalse';
import { CommandRegistry, type Command } from './types';

export * from './types';
export {
  cat,
  cd,
  clear,
  cp,
  echo,
  find,
  grep,
  head,
  less,
  ls,
  man,
  mkdir,
  mv,
  pwd,
  rm,
  rmdir,
  sort,
  tail,
  touch,
  uniq,
  wc,
};

/** Every command implemented so far. */
export const allCommands: Command[] = [
  ...[cat, cd, clear, cp, echo, falseCmd, find, grep, head, less, ls, man],
  ...[mkdir, mv, pwd, rm, rmdir, sort, tail, touch, trueCmd, uniq, wc],
  ...[chmod, chown, id, sudo, whoami],
];

export function createRegistry(): CommandRegistry {
  return new CommandRegistry().register(...allCommands);
}

import { cat } from './cat';
import { cd } from './cd';
import { clear } from './clear';
import { echo } from './echo';
import { exit } from './exit';
import { alias, dot, env, exportCmd, printenv, source, type, unalias, which } from './envops';
import { cp, mkdir, mv, rm, rmdir, touch } from './fileops';
import { head, tail } from './headtail';
import { less } from './less';
import { ls } from './ls';
import { man } from './man';
import { chmod, chown, id, sudo, whoami } from './permops';
import { bg, fg, jobs, kill, pgrep, pkill, ps, sleep, top } from './procops';
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
  ...[bg, fg, jobs, kill, pgrep, pkill, ps, sleep, top],
  ...[alias, dot, env, exportCmd, printenv, source, type, unalias, which, exit],
];

export function createRegistry(): CommandRegistry {
  return new CommandRegistry().register(...allCommands);
}

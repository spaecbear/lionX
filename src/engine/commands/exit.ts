import { ScriptExit } from '../shell/executor';
import { defineCommand } from './util';

/** Bash builtin exit: ends a script, or (at the prompt) leaves the shell. */
export const exit = defineCommand({
  name: 'exit',
  unlockedInAct: 0,
  builtin: true,
  options: {},
  run(opts, _io, ctx) {
    const code = Number(opts.operands[0] ?? 0) & 255;
    if (ctx.exec?.inScript) throw new ScriptExit(code);
    ctx.exec?.requestExit(code);
    return code;
  },
});

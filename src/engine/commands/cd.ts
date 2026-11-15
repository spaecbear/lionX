import { defineCommand, reason } from './util';

/** Bash builtin `cd`: no argument means $HOME, `-` means $OLDPWD (and prints it). */
export const cd = defineCommand({
  name: 'cd',
  unlockedInAct: 1,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'LPe', stopAtOperand: true },
  run(opts, io, ctx) {
    const err = (msg: string) => {
      io.stderr.write(`${ctx.shellName}: cd: ${msg}\n`);
      return 1;
    };
    if (opts.operands.length > 1) return err('too many arguments');
    let target = opts.operands[0];
    let print = false;
    if (target === undefined) {
      target = ctx.env.get('HOME') ?? '';
      if (!target) return err('HOME not set');
    } else if (target === '-') {
      target = ctx.env.get('OLDPWD') ?? '';
      if (!target) return err('OLDPWD not set');
      print = true;
    }
    if (target === '') return 0; // `cd ""` is a no-op in Bash
    const old = ctx.vfs.cwd;
    try {
      ctx.vfs.chdir(target);
    } catch (e) {
      return err(`${target}: ${reason(e)}`);
    }
    ctx.env.set('OLDPWD', old);
    ctx.env.set('PWD', ctx.vfs.cwd);
    if (print) io.stdout.write(ctx.vfs.cwd + '\n');
    return 0;
  },
});

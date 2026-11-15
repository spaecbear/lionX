import { defineCommand } from './util';

/** Bash builtin `pwd`. The VFS has no symlinks, so -L and -P agree. */
export const pwd = defineCommand({
  name: 'pwd',
  unlockedInAct: 1,
  builtin: true,
  usageStatus: 2,
  options: { flags: 'LP', stopAtOperand: true },
  // Bash 5.2 ignores extra operands.
  run(_opts, io, ctx) {
    io.stdout.write(ctx.vfs.cwd + '\n');
    return 0;
  },
});

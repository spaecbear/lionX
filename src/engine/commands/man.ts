import { page } from './pager';
import { defineCommand } from './util';

/** Center `title` between left and right labels, man-style, in `width` columns. */
function headerLine(left: string, center: string, right: string, width: number): string {
  const space = width - left.length - right.length;
  if (space < center.length + 2) return `${left} ${right}`;
  const before = Math.floor((space - center.length) / 2);
  return left + ' '.repeat(before) + center + ' '.repeat(space - center.length - before) + right;
}

/** `man`: open a spell's page in the Grimoire. */
export const man = defineCommand({
  name: 'man',
  unlockedInAct: 2,
  options: {},
  async run(opts, io, ctx) {
    if (opts.operands.length === 0) {
      io.stderr.write("What manual page do you want?\nFor example, try 'man man'.\n");
      return 1;
    }
    let status = 0;
    const width = Math.min(80, io.tty?.cols ?? (Number(ctx.env.get('COLUMNS')) || 80));
    for (const name of opts.operands) {
      const cmd = ctx.registry.get(name);
      if (!cmd || !cmd.manPage) {
        io.stderr.write(`No manual entry for ${name}\n`);
        status = 16;
        continue;
      }
      const tag = `${name.toUpperCase()}(1)`;
      const text =
        headerLine(tag, 'Grimoire of the Archive', tag, width) +
        '\n\n' +
        cmd.manPage.replace(/\n*$/, '\n') +
        '\n' +
        headerLine('Archive of Echoes', '', tag, width) +
        '\n';
      await page(text, io, `Manual page ${name}(1)`);
    }
    return status;
  },
});

import { page } from './pager';
import { defineCommand, readInputs } from './util';

/** `less`: page through files or stdin. Several files are shown one after another. */
export const less = defineCommand({
  name: 'less',
  unlockedInAct: 2,
  options: { flags: 'NRSFX' },
  async run(opts, io, ctx) {
    if (opts.operands.length === 0 && io.stdinIsTerminal) {
      io.stderr.write('Missing filename ("less --help" for help)\n');
      return 1;
    }
    const inputs = readInputs(opts.operands, io, ctx, (p, why, kind) =>
      kind === 'read' ? `${p} is a directory` : `${p}: ${why}`,
    );
    const ok = inputs.filter((f) => !f.failed);
    if (ok.length) {
      let text = ok.map((f) => f.text).join('');
      if (opts.has('N')) {
        text =
          text
            .replace(/\n$/, '')
            .split('\n')
            .map((l, i) => `${String(i + 1).padStart(7)} ${l}`)
            .join('\n') + '\n';
      }
      await page(
        text,
        io,
        ok.length === 1 && ok[0].name !== 'standard input' ? ok[0].name : undefined,
      );
    }
    return inputs.some((f) => f.failed) ? 1 : 0;
  },
});

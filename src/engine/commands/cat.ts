import { defineCommand, readInputs, splitLines } from './util';

/** GNU `cat`: concatenate files (or stdin) to stdout. Supports -n, -b, -E, -s. */
export const cat = defineCommand({
  name: 'cat',
  unlockedInAct: 2,
  options: {
    flags: 'nbEsAu',
    long: {
      // Same order as GNU's option table, so ambiguity messages list them alike.
      'number-nonblank': { key: 'b' },
      number: { key: 'n' },
      'show-ends': { key: 'E' },
      'squeeze-blank': { key: 's' },
    },
  },
  run(opts, io, ctx) {
    const inputs = readInputs(opts.operands, io, ctx, (p, why) => `cat: ${p}: ${why}`);
    const numberAll = opts.has('n');
    const numberNonBlank = opts.has('b');
    const showEnds = opts.has('E');
    const squeeze = opts.has('s');
    // Line numbering continues across files, like GNU cat.
    let n = 0;
    let prevBlank = false;
    for (const f of inputs) {
      if (f.failed) continue;
      if (!numberAll && !numberNonBlank && !showEnds && !squeeze) {
        io.stdout.write(f.text);
        continue;
      }
      let out = '';
      for (const line of splitLines(f.text)) {
        const body = line.endsWith('\n') ? line.slice(0, -1) : line;
        const nl = line.endsWith('\n');
        const blank = body === '' && nl;
        if (squeeze && blank && prevBlank) continue;
        prevBlank = blank;
        let prefix = '';
        if (numberNonBlank ? !blank : numberAll) prefix = `${String(++n).padStart(6)}\t`;
        out += prefix + body + (nl ? (showEnds ? '$\n' : '\n') : '');
      }
      io.stdout.write(out);
    }
    return inputs.some((f) => f.failed) ? 1 : 0;
  },
});

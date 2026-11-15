/**
 * GNU getopt_long-style option parsing, so every command accepts arguments
 * the way coreutils does: bundled short flags (-la), values attached or
 * separate (-n5, -n 5), long options with unambiguous prefixes (--al),
 * `--opt=value`, options after operands (permutation), and `--` to stop.
 */

export interface LongOption {
  /** Key stored in the result (often a short-flag letter it aliases). */
  key: string;
  takesValue?: boolean;
  /** Value allowed only as `--opt=value` (getopt's optional_argument). Bare `--opt` is a flag. */
  optionalValue?: boolean;
}

export interface OptionSpec {
  /** Short flags without a value, e.g. "aAlh1". */
  flags?: string;
  /** Short options that take a value, e.g. "n". */
  withValue?: string;
  long?: Record<string, LongOption>;
  /** Stop at the first operand instead of permuting (Bash builtins do this). */
  stopAtOperand?: boolean;
}

export interface ParsedOptions {
  /** Flags in order of appearance (later ones may override earlier ones). */
  flags: string[];
  values: Map<string, string>;
  operands: string[];
  has(key: string): boolean;
}

export class OptionError extends Error {}

export function parseOptions(args: string[], spec: OptionSpec): ParsedOptions {
  const flags: string[] = [];
  const values = new Map<string, string>();
  const operands: string[] = [];
  const shortFlags = spec.flags ?? '';
  const shortValues = spec.withValue ?? '';
  const longs = spec.long ?? {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const exact = longs[name] ? [name] : [];
      const matches = exact.length ? exact : Object.keys(longs).filter((l) => l.startsWith(name));
      const distinct = new Set(matches.map((m) => longs[m].key));
      if (matches.length === 0) throw new OptionError(`unrecognized option '${a}'`);
      if (distinct.size > 1) {
        throw new OptionError(
          `option '${a}' is ambiguous; possibilities:${matches.map((m) => ` '--${m}'`).join('')}`,
        );
      }
      const full = matches[0];
      const opt = longs[full];
      if (opt.optionalValue) {
        if (eq === -1) flags.push(opt.key);
        else values.set(opt.key, a.slice(eq + 1));
      } else if (opt.takesValue) {
        let v: string | undefined = eq === -1 ? undefined : a.slice(eq + 1);
        if (v === undefined) {
          if (i + 1 >= args.length)
            throw new OptionError(`option '--${full}' requires an argument`);
          v = args[++i];
        }
        values.set(opt.key, v);
      } else {
        if (eq !== -1) throw new OptionError(`option '--${full}' doesn't allow an argument`);
        flags.push(opt.key);
      }
      continue;
    }
    if (a.startsWith('-') && a !== '-') {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (shortValues.includes(c)) {
          let v = a.slice(j + 1);
          if (v === '') {
            if (i + 1 >= args.length)
              throw new OptionError(`option requires an argument -- '${c}'`);
            v = args[++i];
          }
          values.set(c, v);
          break;
        }
        if (!shortFlags.includes(c)) throw new OptionError(`invalid option -- '${c}'`);
        flags.push(c);
      }
      continue;
    }
    operands.push(a);
    if (spec.stopAtOperand) {
      operands.push(...args.slice(i + 1));
      break;
    }
  }
  return { flags, values, operands, has: (k) => flags.includes(k) };
}

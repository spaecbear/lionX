import type { Rng } from './rng';

/** How a duty template parameter gets its value. Later params may use earlier ones in `text`. */
export type ParamDef =
  | { pick: (string | number)[] }
  | { int: [number, number] }
  | { byDifficulty: (string | number)[] }
  | { text: string };

export type Params = Record<string, string>;

/** Replace `{name}` with param values everywhere in a value (strings, arrays, object keys). */
export function substitute<T>(value: T, params: Params): T {
  const sub = (s: string) =>
    s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
      if (!(name in params)) throw new Error(`Unknown template parameter {${name}}`);
      return params[name];
    });
  if (typeof value === 'string') return sub(value) as T;
  if (Array.isArray(value)) return value.map((v) => substitute(v, params)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [sub(k), substitute(v, params)]),
    ) as T;
  }
  return value;
}

/** Choose a value for every parameter, in order. `difficulty` is 1, 2, or 3. */
export function chooseParams(defs: Record<string, ParamDef>, rng: Rng, difficulty: number): Params {
  const params: Params = { difficulty: String(difficulty) };
  for (const [name, def] of Object.entries(defs)) {
    if ('pick' in def) params[name] = String(rng.pick(def.pick));
    else if ('int' in def) params[name] = String(rng.int(def.int[0], def.int[1]));
    else if ('byDifficulty' in def) {
      const i = Math.min(difficulty, def.byDifficulty.length) - 1;
      params[name] = String(def.byDifficulty[i]);
    } else params[name] = substitute(def.text, params);
  }
  return params;
}

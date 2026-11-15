import { parse as parseYaml } from 'yaml';
import { PREDICATE_KEYS, type Predicate } from '../validator';
import {
  GUIDE_LEVELS,
  type CoachingRule,
  type GuideLevel,
  type Lesson,
  type Step,
  type Wing,
  type WorldPatch,
} from './schema';

export class ContentError extends Error {}

type Obj = Record<string, unknown>;

/** Small checking helpers that report where in the file a problem is. */
class Checker {
  constructor(private source: string) {}

  fail(path: string, msg: string): never {
    throw new ContentError(`${this.source}: ${path}: ${msg}`);
  }
  obj(v: unknown, path: string): Obj {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      this.fail(path, 'expected a mapping');
    return v as Obj;
  }
  str(v: unknown, path: string): string {
    if (typeof v !== 'string' || v.trim() === '') this.fail(path, 'expected non-empty text');
    return v;
  }
  optStr(v: unknown, path: string): string | undefined {
    return v === undefined ? undefined : this.str(v, path);
  }
  arr(v: unknown, path: string): unknown[] {
    if (!Array.isArray(v)) this.fail(path, 'expected a list');
    return v;
  }
  /** A single line or a list of lines. */
  lines(v: unknown, path: string): string[] | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'string') return [this.str(v, path)];
    return this.arr(v, path).map((x, i) => this.str(x, `${path}[${i}]`));
  }
  regex(v: unknown, path: string): string | undefined {
    const s = this.optStr(v, path);
    if (s !== undefined) {
      try {
        new RegExp(s);
      } catch (e) {
        this.fail(path, `invalid pattern: ${(e as Error).message}`);
      }
    }
    return s;
  }
  noExtra(o: Obj, allowed: string[], path: string) {
    for (const k of Object.keys(o))
      if (!allowed.includes(k)) this.fail(`${path}.${k}`, 'unknown field');
  }
  /** Player-facing text rules from CLAUDE.md. */
  playerText(s: string, path: string) {
    if (s.includes('—')) this.fail(path, 'no em dashes in player-facing text');
    if (/\b(act|level|area)s?\b/i.test(s))
      this.fail(path, 'player text must not say "act", "level", or "area"');
  }
}

export function checkPredicate(c: Checker, v: unknown, path: string): Predicate {
  const o = c.obj(v, path);
  const keys = Object.keys(o);
  if (keys.length !== 1)
    c.fail(path, `a goal has exactly one kind, got: ${keys.join(', ') || 'none'}`);
  const k = keys[0];
  if (!(PREDICATE_KEYS as readonly string[]).includes(k)) {
    c.fail(path, `unknown goal "${k}" (known: ${PREDICATE_KEYS.join(', ')})`);
  }
  const val = o[k];
  const p = `${path}.${k}`;
  switch (k) {
    case 'all':
    case 'any':
      return { [k]: c.arr(val, p).map((x, i) => checkPredicate(c, x, `${p}[${i}]`)) } as Predicate;
    case 'not':
      return { not: checkPredicate(c, val, p) };
    case 'contains': {
      const m = c.obj(val, p);
      c.noExtra(m, ['path', 'text', 'pattern'], p);
      if (m.text === undefined && m.pattern === undefined) c.fail(p, 'needs text or pattern');
      return {
        contains: {
          path: c.str(m.path, `${p}.path`),
          text: c.optStr(m.text, `${p}.text`),
          pattern: c.regex(m.pattern, `${p}.pattern`),
        },
      };
    }
    case 'mode': {
      const m = c.obj(val, p);
      const mode = String(m.mode ?? '');
      if (!/^[0-7]{3,4}$/.test(mode)) c.fail(`${p}.mode`, 'expected octal like "640"');
      return { mode: { path: c.str(m.path, `${p}.path`), mode } };
    }
    case 'owner': {
      const m = c.obj(val, p);
      if (m.owner === undefined && m.group === undefined) c.fail(p, 'needs owner or group');
      return {
        owner: {
          path: c.str(m.path, `${p}.path`),
          owner: c.optStr(m.owner, `${p}.owner`),
          group: c.optStr(m.group, `${p}.group`),
        },
      };
    }
    case 'ran': {
      if (typeof val === 'string') return { ran: c.str(val, p) };
      const m = c.obj(val, p);
      c.noExtra(m, ['command', 'status', 'args'], p);
      return {
        ran: {
          command: c.str(m.command, `${p}.command`),
          status: m.status === undefined ? undefined : Number(m.status),
          args:
            m.args === undefined
              ? undefined
              : c.arr(m.args, `${p}.args`).map((a, i) => c.str(a, `${p}.args[${i}]`)),
        },
      };
    }
    default:
      return { [k]: c.str(val, p) } as Predicate;
  }
}

function checkCoaching(c: Checker, v: unknown, path: string): CoachingRule[] | undefined {
  if (v === undefined) return undefined;
  return c.arr(v, path).map((x, i) => {
    const p = `${path}[${i}]`;
    const o = c.obj(x, p);
    c.noExtra(o, ['line', 'stderr', 'failed', 'say'], p);
    if (o.line === undefined && o.stderr === undefined) c.fail(p, 'needs line or stderr');
    const say = c.str(o.say, `${p}.say`);
    c.playerText(say, `${p}.say`);
    return {
      line: c.regex(o.line, `${p}.line`),
      stderr: c.regex(o.stderr, `${p}.stderr`),
      failed: o.failed === undefined ? undefined : Boolean(o.failed),
      say,
    };
  });
}

function checkPatch(c: Checker, v: unknown, path: string): WorldPatch | undefined {
  if (v === undefined) return undefined;
  const o = c.obj(v, path);
  c.noExtra(o, ['dirs', 'files'], path);
  return o as WorldPatch;
}

function checkSay(c: Checker, v: unknown, path: string): string[] | undefined {
  const ls = c.lines(v, path);
  ls?.forEach((l, i) => c.playerText(l, `${path}[${i}]`));
  return ls;
}

function checkStep(c: Checker, v: unknown, path: string): Step {
  const o = c.obj(v, path);
  c.noExtra(o, ['id', 'goal', 'guide', 'guidance', 'hints', 'success', 'coaching'], path);
  const guide = (o.guide ?? 'exact') as GuideLevel;
  if (!GUIDE_LEVELS.includes(guide))
    c.fail(`${path}.guide`, `expected one of ${GUIDE_LEVELS.join(', ')}`);
  const g = c.obj(o.guidance, `${path}.guidance`);
  c.noExtra(g, GUIDE_LEVELS, `${path}.guidance`);
  const guidance: Step['guidance'] = {};
  // Every level from `exact` up to the step's own level must be written, so Quill can step back.
  for (const level of GUIDE_LEVELS.slice(0, GUIDE_LEVELS.indexOf(guide) + 1)) {
    guidance[level] = c.str(g[level], `${path}.guidance.${level}`);
    c.playerText(guidance[level]!, `${path}.guidance.${level}`);
  }
  const hints = c.arr(o.hints, `${path}.hints`);
  if (hints.length !== 3)
    c.fail(`${path}.hints`, 'expected exactly 3 hints: a nudge, the spell, the full syntax');
  return {
    id: c.str(o.id, `${path}.id`),
    goal: checkPredicate(c, o.goal, `${path}.goal`),
    guide,
    guidance,
    hints: hints.map((h, i) => {
      const s = c.str(h, `${path}.hints[${i}]`);
      c.playerText(s, `${path}.hints[${i}]`);
      return s;
    }) as Step['hints'],
    success: checkSay(c, o.success, `${path}.success`),
    coaching: checkCoaching(c, o.coaching, `${path}.coaching`),
  };
}

function checkLesson(c: Checker, v: unknown, path: string): Lesson {
  const o = c.obj(v, path);
  c.noExtra(o, ['id', 'spells', 'setup', 'intro', 'steps', 'outro'], path);
  const steps = c
    .arr(o.steps, `${path}.steps`)
    .map((s, i) => checkStep(c, s, `${path}.steps[${i}]`));
  if (steps.length === 0) c.fail(`${path}.steps`, 'a lesson needs at least one step');
  return {
    id: c.str(o.id, `${path}.id`),
    spells: (o.spells === undefined ? [] : c.arr(o.spells, `${path}.spells`)).map((s, i) =>
      c.str(s, `${path}.spells[${i}]`),
    ),
    setup: checkPatch(c, o.setup, `${path}.setup`),
    intro: checkSay(c, o.intro, `${path}.intro`),
    steps,
    outro: checkSay(c, o.outro, `${path}.outro`),
  };
}

function uniqueIds(c: Checker, items: { id: string }[], path: string) {
  const seen = new Set<string>();
  items.forEach((it, i) => {
    if (seen.has(it.id)) c.fail(`${path}[${i}].id`, `duplicate id "${it.id}"`);
    seen.add(it.id);
  });
}

/** Parse and validate a wing written in YAML. */
export function loadWing(yamlText: string, source = 'wing.yaml'): Wing {
  const c = new Checker(source);
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (e) {
    throw new ContentError(`${source}: invalid YAML: ${(e as Error).message}`);
  }
  const o = c.obj(doc, '(root)');
  c.noExtra(o, ['id', 'banner', 'world', 'intro', 'lessons', 'outro', 'coaching'], '(root)');
  const world = c.obj(o.world, 'world');
  const user = c.obj(world.user, 'world.user');
  c.str(user.name, 'world.user.name');
  c.str(user.home, 'world.user.home');
  c.arr(user.groups, 'world.user.groups');
  const lessons = c.arr(o.lessons, 'lessons').map((l, i) => checkLesson(c, l, `lessons[${i}]`));
  if (lessons.length === 0) c.fail('lessons', 'a wing needs at least one lesson');
  uniqueIds(c, lessons, 'lessons');
  lessons.forEach((l, i) => uniqueIds(c, l.steps, `lessons[${i}].steps`));
  return {
    id: c.str(o.id, 'id'),
    banner: c.optStr(o.banner, 'banner'),
    world: world as unknown as Wing['world'],
    intro: checkSay(c, o.intro, 'intro'),
    lessons,
    outro: checkSay(c, o.outro, 'outro'),
    coaching: checkCoaching(c, o.coaching, 'coaching'),
  };
}

/** Parse shared coaching rules (src/content/coaching.yaml). */
export function loadCoaching(yamlText: string, source = 'coaching.yaml'): CoachingRule[] {
  const c = new Checker(source);
  const doc = parseYaml(yamlText) as unknown;
  const o = c.obj(doc, '(root)');
  return checkCoaching(c, o.rules, 'rules') ?? [];
}

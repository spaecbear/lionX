import type { WorldPatch } from '../content/schema';
import type { Predicate } from '../validator';
import type { Rng } from './rng';
import { chooseParams, substitute, type ParamDef, type Params } from './template';

export interface DutyTemplate {
  id: string;
  /** Spells the duty exercises. Every one must be known for the duty to be offered. */
  spells: string[];
  params: Record<string, ParamDef>;
  /** Placed into the world (as root) when the duty begins. */
  setup?: WorldPatch;
  /** Paths removed (as root) once the duty is done, so the stacks don't fill up. */
  cleanup?: string[];
  brief: string;
  hints: [string, string, string];
  goal: Predicate;
  /** A tidy solution, used by tests to prove every duty is solvable. */
  solution: string[];
  /** Commands expected for a swift solution; defaults to the solution's length. */
  par?: number;
  success?: string;
}

/** One generated duty: a template with its parameters filled in. */
export interface Duty {
  signature: string;
  templateId: string;
  params: Params;
  spells: string[];
  brief: string;
  hints: [string, string, string];
  goal: Predicate;
  setup?: WorldPatch;
  cleanup: string[];
  solution: string[];
  par: number;
  success?: string;
}

export interface GenerateOptions {
  known: string[];
  /** The current wing's spells; duties using them are preferred. */
  focus: string[];
  difficulty: number;
  rng: Rng;
  /** Signatures to avoid (recent duties). */
  recent: string[];
  /** True if a path already exists in the world (setup must not collide). */
  exists?: (path: string) => boolean;
}

/** Chance of picking from all eligible templates instead of the focused ones, to mix in older spells. */
export const MIX_OLDER = 0.3;
const MAX_TRIES = 60;

export function instantiate(t: DutyTemplate, params: Params): Duty {
  const signature = `${t.id}:${Object.entries(params)
    .filter(([k]) => k !== 'difficulty')
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`;
  const solution = substitute(t.solution, params);
  return {
    signature,
    templateId: t.id,
    params,
    spells: t.spells,
    brief: substitute(t.brief, params),
    hints: substitute(t.hints, params),
    goal: substitute(t.goal, params),
    setup: t.setup ? substitute(t.setup, params) : undefined,
    cleanup: substitute(t.cleanup ?? [], params),
    solution,
    par: t.par ?? solution.length,
    success: t.success ? substitute(t.success, params) : undefined,
  };
}

/** Pick and fill in a fresh duty, or null if no template fits the known spells. */
export function generateDuty(templates: DutyTemplate[], o: GenerateOptions): Duty | null {
  const eligible = templates.filter((t) => t.spells.every((s) => o.known.includes(s)));
  if (eligible.length === 0) return null;
  const focused = eligible.filter((t) => t.spells.some((s) => o.focus.includes(s)));
  let fallback: Duty | null = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    const pool = focused.length && !o.rng.chance(MIX_OLDER) ? focused : eligible;
    const t = o.rng.pick(pool);
    const duty = instantiate(t, chooseParams(t.params, o.rng, o.difficulty));
    const paths = [
      ...(duty.setup?.dirs ?? []).map((d) => (typeof d === 'string' ? d : d.path)),
      ...Object.keys(duty.setup?.files ?? {}),
    ];
    if (o.exists && paths.some((p) => o.exists!(p))) continue;
    fallback ??= duty;
    if (!o.recent.includes(duty.signature)) return duty;
  }
  return fallback;
}

import type { RunnerSnapshot } from '../narrative';
import type { ProgressState } from '../progression';
import type { VfsSnapshot } from '../vfs';

/** Bump when the save shape changes, and add a migration from the previous version. */
export const SAVE_VERSION = 1;
export const SLOT_COUNT = 3;
const KEY_PREFIX = 'archive-of-echoes:slot:';

/** Everything needed to put the player back exactly where they were. */
export interface SaveData {
  version: number;
  savedAt: number;
  vfs: VfsSnapshot;
  runner: RunnerSnapshot;
  progress: ProgressState;
  /** Shell variables (PWD, OLDPWD, and anything the player set). */
  env: Record<string, string>;
  /** Command history for the up arrow. */
  history: string[];
}

/** The subset of the Web Storage API saves need. Inject `localStorage`, or a Map in tests. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveError extends Error {}

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade *from*. Each takes a save of
 * version N and returns one of version N + 1. Version 1 is the first released
 * format, so the table starts empty; add entries here as the format evolves.
 */
export const MIGRATIONS: Record<number, Migration> = {};

/** Upgrade a parsed save to the current version, oldest migration first. */
export function migrate(
  raw: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SAVE_VERSION,
): SaveData {
  let data = raw;
  let version = typeof data.version === 'number' ? data.version : NaN;
  if (!Number.isInteger(version) || version < 0) throw new SaveError('Save has no valid version');
  if (version > target)
    throw new SaveError(`Save is from a newer version (${version}) of the game`);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveError(`No way to upgrade a version ${version} save`);
    data = { ...step(data), version: version + 1 };
    version++;
  }
  for (const field of ['vfs', 'runner', 'progress'] as const) {
    if (typeof data[field] !== 'object' || data[field] === null)
      throw new SaveError(`Save is missing ${field}`);
  }
  return data as unknown as SaveData;
}

const key = (slot: number) => {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT)
    throw new SaveError(`No slot ${slot}`);
  return KEY_PREFIX + slot;
};

/** Write a slot. Returns false (never throws) when storage is full, blocked, or unavailable. */
export function writeSlot(storage: SaveStorage | null, slot: number, data: SaveData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key(slot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export type SlotRead =
  { status: 'empty' } | { status: 'ok'; data: SaveData } | { status: 'broken'; reason: string };

/** Read and upgrade a slot. Unreadable or corrupt saves are reported, not thrown. */
export function readSlot(storage: SaveStorage | null, slot: number): SlotRead {
  let text: string | null;
  try {
    text = storage ? storage.getItem(key(slot)) : null;
  } catch {
    return { status: 'broken', reason: 'storage is unavailable' };
  }
  if (text === null) return { status: 'empty' };
  try {
    return { status: 'ok', data: migrate(JSON.parse(text)) };
  } catch (e) {
    return { status: 'broken', reason: e instanceof SaveError ? e.message : 'the save is damaged' };
  }
}

export function eraseSlot(storage: SaveStorage | null, slot: number): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key(slot));
    return true;
  } catch {
    return false;
  }
}

/** localStorage if it works here, else null (private windows, blocked storage, previews). */
export function browserStorage(): SaveStorage | null {
  try {
    const s = globalThis.localStorage;
    const probe = KEY_PREFIX + 'probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** An in-memory store (tests, or when the browser blocks storage). */
export function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

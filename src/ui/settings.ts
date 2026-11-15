import { DEFAULT_SETTINGS, type Settings } from '../engine/settings';

const KEY = 'archive-of-echoes:settings';

/** Preferences live apart from save slots, in this browser only. Never throws. */
export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: typeof s.theme === 'string' ? s.theme : DEFAULT_SETTINGS.theme,
      motion: s.motion === 'on' || s.motion === 'off' ? s.motion : 'auto',
      reader: s.reader === true,
      music: s.music !== false,
      volume:
        typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 10
          ? Math.round(s.volume)
          : DEFAULT_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private windows and blocked storage: settings last for this visit only.
  }
}

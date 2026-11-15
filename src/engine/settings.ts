import { defineCommand } from './commands/util';

/** Player preferences, kept apart from save slots. */
export interface Settings {
  theme: string;
  /** auto follows the device's reduced-motion preference. */
  motion: 'auto' | 'on' | 'off';
  /** Screen-reader mode: no ASCII art, no animation, announced output. */
  reader: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'candlelit', motion: 'auto', reader: false };

export interface SettingsHost {
  get(): Settings;
  set(next: Settings): void;
  /** Every theme, and whether this player may use it yet. */
  themes(): { name: string; available: boolean }[];
}

/**
 * `settings`: show or change preferences. Works on the title screen and in
 * the Archive. Examples: settings theme parchment, settings motion off,
 * settings reader on.
 */
export function createSettingsCommand(host: SettingsHost) {
  return defineCommand({
    name: 'settings',
    unlockedInAct: 0,
    options: {},
    run(o, io) {
      const s = host.get();
      const [key, value] = o.operands;
      if (!key) {
        const themes = host
          .themes()
          .map(
            (t) =>
              `${t.name === s.theme ? '*' : ' '} ${t.name}${t.available ? '' : ' (not yet earned)'}`,
          )
          .join('\n    ');
        io.stdout.write(
          `  theme:   ${s.theme}\n    ${themes}\n  motion:  ${s.motion}\n  reader:  ${s.reader ? 'on' : 'off'}\n\n` +
            '  Change one with: settings theme NAME, settings motion on|off|auto, settings reader on|off\n',
        );
        return 0;
      }
      if (key === 'theme') {
        const t = host.themes().find((x) => x.name === value);
        if (!t) {
          io.stderr.write(`settings: no theme called ${value ?? '(nothing)'}\n`);
          return 1;
        }
        if (!t.available) {
          io.stderr.write(`settings: you have not earned the ${value} theme yet\n`);
          return 1;
        }
        host.set({ ...s, theme: t.name });
        return 0;
      }
      if (key === 'motion' && (value === 'on' || value === 'off' || value === 'auto')) {
        host.set({ ...s, motion: value });
        return 0;
      }
      if (key === 'reader' && (value === 'on' || value === 'off')) {
        host.set({ ...s, reader: value === 'on' });
        return 0;
      }
      io.stderr.write(
        'settings: try settings theme NAME, settings motion on|off|auto, or settings reader on|off\n',
      );
      return 1;
    },
  });
}

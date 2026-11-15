import { defineCommand } from './commands/util';

/** Player preferences, kept apart from save slots. */
export interface Settings {
  theme: string;
  /** auto follows the device's reduced-motion preference. */
  motion: 'auto' | 'on' | 'off';
  /** Screen-reader mode: no ASCII art, no animation, announced output. */
  reader: boolean;
  /** The lo-fi soundtrack. */
  music: boolean;
  /** Soundtrack volume, 0 to 10. */
  volume: number;
  /** A secret song to play everywhere, or auto (each wing's own). */
  song: string;
  /** Easy mode: hints and solution do not slow progress. */
  easy: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'candlelit',
  motion: 'auto',
  reader: false,
  music: true,
  volume: 4,
  song: 'auto',
  easy: false,
};

export interface SettingsHost {
  get(): Settings;
  set(next: Settings): void;
  /** Every theme, and whether this player may use it yet. */
  themes(): { name: string; available: boolean }[];
  /** Secret songs, and whether this player has found each. */
  songs?(): { name: string; available: boolean }[];
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
          .map((t) => (t.available ? `${t.name === s.theme ? '*' : ' '} ${t.name}` : '  ???'))
          .join('\n    ');
        io.stdout.write(
          `  theme:   ${s.theme}\n    ${themes}\n  motion:  ${s.motion}\n  reader:  ${s.reader ? 'on' : 'off'}\n` +
            `  music:   ${s.music ? 'on' : 'off'}\n  volume:  ${s.volume}\n` +
            `  song:    ${s.song}${songList(host, s)}\n` +
            `  easy:    ${s.easy ? 'on' : 'off'} (hints do not slow your progress)\n\n` +
            '  Change one with:\n' +
            '    settings theme NAME\n    settings motion on|off|auto\n    settings reader on|off\n' +
            '    settings music on|off\n    settings volume 0-10\n    settings song NAME|auto\n    settings easy on|off\n' +
            '  ??? is still hidden somewhere in the Archive.\n',
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
      if (key === 'music' && (value === 'on' || value === 'off')) {
        host.set({ ...s, music: value === 'on' });
        return 0;
      }
      if (key === 'song') {
        if (value === 'auto') {
          host.set({ ...s, song: 'auto' });
          return 0;
        }
        const song = host.songs?.().find((x) => x.name === value);
        if (!song) {
          io.stderr.write(`settings: no song called ${value ?? '(nothing)'}\n`);
          return 1;
        }
        if (!song.available) {
          io.stderr.write(`settings: you have not found the ${value} song yet\n`);
          return 1;
        }
        host.set({ ...s, song: song.name });
        return 0;
      }
      if (key === 'easy' && (value === 'on' || value === 'off')) {
        host.set({ ...s, easy: value === 'on' });
        return 0;
      }
      if (key === 'volume' && /^(10|[0-9])$/.test(value ?? '')) {
        host.set({ ...s, volume: Number(value) });
        return 0;
      }
      io.stderr.write(
        'settings: try settings theme NAME, settings motion on|off|auto, settings reader on|off, settings music on|off, or settings volume 0-10\n',
      );
      return 1;
    },
  });
}

/** The secret songs under the song setting: found ones by name, the rest as ??? so they stay secret. */
function songList(host: SettingsHost, s: Settings): string {
  const songs = host.songs?.() ?? [];
  if (!songs.length) return '';
  const rows = [
    `${s.song === 'auto' ? '*' : ' '} auto (each wing's own)`,
    ...songs.map((x) => (x.available ? `${x.name === s.song ? '*' : ' '} ${x.name}` : '  ???')),
  ];
  return '\n    ' + rows.join('\n    ');
}

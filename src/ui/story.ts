import { parse } from 'yaml';
import { defineCommand } from '../engine/commands/util';
import storyYaml from '../content/story.yaml?raw';

const lines = parse(storyYaml) as {
  note: string;
  on: string;
  auto: string;
  off: string;
  end: string;
};

/** The narrator's line when story mode has nothing more to play. */
export const STORY_END = lines.end;

/** `story on|auto|off`: the secret spell. Not listed anywhere; found in ~/.story-mode. */
export function createStoryCommand(host: { set(mode: 'on' | 'auto' | 'off'): void }) {
  return defineCommand({
    name: 'story',
    unlockedInAct: 0,
    options: {},
    run(o, io) {
      const mode = o.operands[0] ?? 'on';
      if (mode !== 'on' && mode !== 'auto' && mode !== 'off') {
        io.stderr.write(`story: try story on, story auto, or story off\n`);
        return 1;
      }
      host.set(mode);
      io.stdout.write(lines[mode]);
      return 0;
    },
  });
}

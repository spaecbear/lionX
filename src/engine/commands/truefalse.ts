import { defineCommand } from './util';

/** `true`: do nothing, successfully. Useful for testing && and ||. */
export const trueCmd = defineCommand({ name: 'true', unlockedInAct: 5, options: {}, run: () => 0 });

/** `false`: do nothing, unsuccessfully (exit status 1). */
export const falseCmd = defineCommand({
  name: 'false',
  unlockedInAct: 5,
  options: {},
  run: () => 1,
});

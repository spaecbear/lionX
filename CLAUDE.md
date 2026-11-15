# Archive of Echoes

A fantasy game that teaches the Linux terminal. Full spec in docs/DESIGN.md; phased plan in
docs/BUILD_PLAN.md. The main antagonist is **lionX**, a runaway guardian process (see DESIGN.md).
lionX is a process/character, never a renamed command.

## Rules

- Commands keep their real names and match GNU coreutils / Bash behavior, including error messages
  and exit codes. When unsure, match real Bash.
- src/engine has zero UI or DOM imports. It must run headless in Vitest.
- Puzzles validate world state, never the exact command typed.
- All game content (lessons, dialogue, worlds, duties, ASCII art) lives in src/content as data
  files, not hard-coded in TypeScript.
- Player-facing text never says "act", "level", or "area".
- Every ASCII art piece has a narrow (40 col) and wide (80 col) variant.
- Mobile is first-class: test every UI change at 375px wide.
- Write tests before or alongside engine code. Keep commits small.
- No em dashes in player-facing text.

## Commands

- `npm run dev` / `npm test` / `npm run lint` / `npm run build`
- `npm run e2e`: builds, then drives real Chromium (desktop and 375px touch) through the title,
  play, commands, Tab, saves, and reload. Run it before committing UI or startup changes; unit
  tests cannot see everything the real screen does. Needs Playwright with Chromium
  (`npm i -D playwright && npx playwright install chromium` on a new machine).

## Working habits

- Run `npx prettier --write` before scripted edits, or use exact edits; reformatted lines are the
  most common reason a scripted change silently misses.
- New content must pass the hint-only playthrough test (`src/engine/playthrough.test.ts`): a
  player who follows only Quill's last hints must finish every wing.

## CI

- Keep GitHub Actions to an absolute minimum. Do not add workflows unless the user asks. Phase 11's
  deploy should be a single workflow triggered manually or on push to main only, never on every
  branch or PR.

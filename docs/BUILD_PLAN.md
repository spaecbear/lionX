# Archive of Echoes: Claude Code Build Plan

Twelve phases take the game from an empty repo to a shippable PWA. Each phase is a self-contained
prompt with a definition of done; finish and play-test one before starting the next.

## How to use this plan

1. The design doc lives at `docs/DESIGN.md`; this plan at `docs/BUILD_PLAN.md`.
2. Start each Claude Code session with: "Read CLAUDE.md, docs/DESIGN.md, and Phase N of
   docs/BUILD_PLAN.md. Plan first, then implement."
3. Work on a branch per phase. Merge only when the definition of done passes.
4. Play-test on a phone and a desktop browser at the end of every phase from Phase 4 on.

## Foundation

### Phase 0: Project setup

Scaffold a Vite + React + TypeScript project with Vitest, ESLint, and Prettier. Create
`src/engine/{vfs,shell,commands,processes,validator,narrative,progression,save}`, `src/ui`, and
`src/content`. Create CLAUDE.md. Add npm scripts for dev, test, build, and lint. Do not build
features.

**Done when:** `npm test`, `npm run lint`, and `npm run build` all pass on an empty app.

### Phase 1: Virtual filesystem

Implement `src/engine/vfs`: an in-memory tree of directories and files with owner, group, mode
bits, and timestamps. Support path resolution for absolute and relative paths, `~`, `.`, `..`,
repeated and trailing slashes. Provide create, read, write, append, move, copy, remove, stat, and
list operations with permission checks that return errno-style errors (ENOENT, EACCES, ENOTDIR,
EISDIR, EEXIST, ENOTEMPTY). Add JSON serialize/load. Write thorough tests.

**Done when:** 100% of vfs functions have tests, including permission denials and edge paths like
`cd ..` at `/`.

### Phase 2: Shell parser and executor

Implement `src/engine/shell`: a tokenizer handling single and double quotes, backslash escapes, and
`$VAR` expansion; glob expansion (`*`, `?`) against the vfs; and a parser producing an AST for
pipelines, `>`, `>>`, `<`, `2>`, `&&`, `;`, and trailing `&`. Add an executor that runs the AST
against a command registry with stdin/stdout/stderr streams and exit codes. Commands are plugins
with the interface in DESIGN.md. Test with a table of real Bash inputs and expected results.

**Done when:** a test suite of 50+ Bash snippets parses and executes correctly using stub commands.

### Phase 3: Terminal UI

Build the terminal screen with xterm.js as the only element on the page. Implement the prompt
(`apprentice@archive:~$`), line editing, cursor movement, Ctrl+C, Ctrl+L, command history with
up/down, and tab completion for commands and paths. Add the amber candlelit theme. Wire input to
the shell executor with temporary `echo` and `clear` commands.

**Done when:** you can type, edit, recall history, tab-complete a path, and see output on desktop.

### Phase 4: Mobile and tablet input

Add the mobile layer from DESIGN.md: a symbol key bar above the keyboard (`/`, `-`, `|`, `>`, `~`,
`.`, `*`, Tab, Ctrl, up, down) with a swipeable second page; tap a filename or directory in output
to insert it at the cursor; a chip row for unlocked commands; `visualViewport` handling so the
prompt stays above the on-screen keyboard; font sizing that fits at least 40 columns in portrait.
Disable autocorrect, autocapitalize, and smart quotes. Narrow vs wide layout switches at 600px.

**Done when:** on a real phone you can type `cd ~/../apprentice` and run `ls | head` without the
system keyboard hiding the prompt.

## Game systems

### Phase 5: First spells

Implement command plugins `pwd`, `ls` (`-a`, `-l`, `-h`), `cd`, `cat`, `head`, `tail` (`-n`),
`less` (simple pager with space, b, q, and touch scrolling), `clear`, `man`, and `--help` for each.
Match GNU output formatting and error messages. Each command declares the wing that unlocks it and
ships a man page written in Grimoire style but technically accurate. Locked commands respond
in-world ("You don't know that spell yet.").

**Done when:** every command has tests for normal use, flags, and errors.

### Phase 6: Content format and lesson runner

Define the content schema in `src/content` as YAML: wings, lessons, dialogue lines, starting
filesystem snapshots, goal predicates, and ASCII art references. Build the lesson runner: Quill
dialogue with skippable typewriter effect, fading guidance, three-step hints, and specific error
coaching. Build the validator with predicates: `exists`, `isDir`, `contains`, `mode`, `owner`,
`processRunning`, `cwdIs`, and `all`/`any` combinators.

**Done when:** a sample two-lesson wing defined only in YAML plays start to finish.

### Phase 7: Duties and mastery

Implement `src/engine/progression`. Duty templates in YAML generate unique restoration tasks that
use only unlocked spells, mixing in older ones. Track per-spell mastery. Adaptive difficulty. When a
wing's spells reach the threshold, unlock its capstone. Solving the capstone mutates the world so
the next wing appears in `ls`. Add the `status` spell and rewards.

**Done when:** a test seeds the generator and confirms 20 duties in a row are unique and solvable.

### Phase 8: Saves

Auto-save the vfs, player state, mastery, and story flags to localStorage after every lesson, duty,
and capstone, wrapped in try/catch. Version the save format with migrations. Add three save slots,
managed through terminal commands on a title screen rendered as terminal output.

**Done when:** a reload mid-duty restores the exact world and cwd.

## Content

### Phase 9: The first two wings

Author the Apprentice Cells and Reading Room wings entirely as content: lessons, Quill dialogue,
starting filesystems, 8+ duty templates each, capstones, and narrow and wide ASCII banners. Write
the opening story beat, the first clue about the Archivist, and the first lionX sigil.

**Done when:** a new player can go from boot to the Bindery entrance with no outside help, on phone
and desktop.

### Phase 10: Wings 3 through 9 (repeat per wing)

Implement the commands for the [WING NAME] wing listed in DESIGN.md, with tests and man pages. Then
author its lessons, dialogue, world, duty templates, capstone, ASCII art, story beat, and lionX
beat as content. Add tests that solve the capstone in at least two different valid ways and that
run 20 generated duties.

| Wing              | Engine work beyond commands                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| 3. Bindery        | Glob edge cases, `rm -r` safety prompts in-world                                                         |
| 4. Observatory    | Large generated text corpora for grep and find                                                           |
| 5. Aqueducts      | Stress-test pipes and redirection from Phase 2                                                           |
| 6. Vault          | Users `archivist` and `lionx`, `sudo` with an in-world password riddle                                   |
| 7. Haunted Stacks | Process table, game clock, animated ASCII spirits, jobs, the lionX process tree                          |
| 8. Undercroft     | Env variables, PATH lookup, `.bashrc` sourced on start, aliases, lionX's PATH hijack                     |
| 9. The Root       | Script execution with shebang, variables, for loops, a minimal nano-style editor, cron, the lionX finale |

**Done when (each wing):** capstone tests pass and a full play-through of that wing takes 20 to 40
minutes.

## Polish and ship

### Phase 11: Polish and release

Add the remaining themes and per-wing accent tints. Add reduced-motion and screen-reader modes. Add
the PWA manifest, icons, and a service worker for offline play. Add the post-game sandbox and side
quests stub. Set up one minimal GitHub Actions workflow (manual trigger or push to main only) that runs tests and deploys to GitHub Pages. Keep Actions usage as low as possible. Run a
Lighthouse audit and fix anything under 90.

**Done when:** the game installs to a phone home screen, plays offline, and a full run from boot to
the ending works with no console errors.

### Before release checklist

- Full play-through on iPhone, Android, iPad, and desktop
- Two outside play-testers who have never used a terminal
- Every command checked against real Bash output
- Save migration tested from the oldest save version

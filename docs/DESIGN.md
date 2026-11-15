# Archive of Echoes: Linux Terminal Game Design Doc

## Overview

Archive of Echoes (working title) is a browser game that teaches the Linux command line through a
fantasy story. The whole game is a terminal. Every room, book, and spirit in a magical library is a
file, directory, or process, and every command is a spell. It runs on desktop, tablet, and phone.

### Pillars

- **Real skills, real syntax.** Commands behave like real Bash. Anything a player learns transfers
  to an actual Linux machine.
- **Any valid solution wins.** Puzzles check the resulting world state, not the exact command typed.
- **The terminal is the art.** No sprites or images. Atmosphere comes from ASCII art, color, and
  text effects.
- **Skills compound.** Each act's final puzzle needs that act's commands plus everything before it.
- **Plays anywhere.** Touch input is a first-class control scheme, not an afterthought.

**Target player:** curious beginners, students, and junior devs who have never opened a terminal or
only know `cd` and `ls`.

## Story and world

You are a new apprentice at the Archive, a library that holds every story ever told. The Archivist
who ran it has vanished, and a creeping Corruption is unraveling the stacks: books go blank, rooms
collapse, and rogue spirits roam the halls. The only tool left is the Lexicon, an old terminal that
lets you speak the Archive's true language.

**Guide:** Quill, a sardonic familiar spirit bound to the Lexicon. Quill explains each new spell,
gives hints, and slowly reveals what happened to the Archivist.

**Central mystery:** The Archivist didn't vanish. They tried to rewrite the Archive's root and got
locked out of their own system. The Corruption is a runaway process they spawned. The finale has
you write the script that ends it.

### The antagonist: lionX

The runaway process has a name: **lionX**. The Archive's true language is called Linux; lionX is
its distorted echo, a guardian daemon the Archivist summoned to watch over the Foundation Stone. When
the Archivist tried to rewrite the root, lionX decided the Archivist was the threat, seized root
authority, and locked them out. Now it believes it _is_ the Archive, and it is "tidying" the stacks
by unwriting every story it does not understand.

Rules for lionX:

- lionX is a **process and a character, never a command.** Commands keep their real names. The
  player meets lionX through files it writes, processes it spawns, and the world state it breaks.
- Its voice is clipped, glitched, and proud. Its lines render with corruption effects (flicker,
  substituted glyphs). It speaks in system-message register: `lionX: permission revoked.`
- Its sigil is a small ASCII lion head (narrow and wide variants) stamped into corrupted files.

How lionX escalates across the wings (each beat teaches the wing's skill):

| Wing                | lionX beat                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Apprentice Cells | Torn pages signed with a lion sigil. Quill refuses to say the name.                                                                                                                |
| 2. Reading Room     | The last lines of the Archivist's journal (via `tail`) name "the guardian I called lionX."                                                                                         |
| 3. Bindery          | lionX's scattered `.lx` fragments must be sorted and quarantined, not deleted.                                                                                                     |
| 4. Observatory      | `grep -r` reveals lionX has scrubbed the Archivist's true name from most pages, but not all.                                                                                       |
| 5. Aqueducts        | lionX floods the channels with noise; the player filters it with pipes and redirects its stderr to `/dev/null`.                                                                    |
| 6. Vault            | lionX holds root. Files owned by `lionx` must be reclaimed with `chown` and `sudo`.                                                                                                |
| 7. Haunted Stacks   | `ps` shows `lionX` itself for the first time, with spirit children. Killing a child just respawns it: the parent must wait.                                                        |
| 8. Undercroft       | lionX has prepended its own directory to `PATH`, shadowing real spells with impostors. `which` exposes the trick.                                                                  |
| 9. The Root         | Final confrontation. lionX respawns via a cron entry. The ritual script must remove the cron entry, kill the process tree, restore the Archivist's ownership, and unseal the root. |

The ending: lionX is not destroyed but stopped and demoted to an ordinary, harmless process the
restored Archivist keeps running at low priority. Quill: "Even guardians need a supervisor."

## The metaphor map

| Linux concept         | In the Archive                                         |
| --------------------- | ------------------------------------------------------ |
| Filesystem root `/`   | The Foundation Stone                                   |
| Directory             | Wing, hall, or room                                    |
| File                  | Book, scroll, or letter                                |
| Hidden file (`.name`) | Secret passage or sealed tome                          |
| Home `~`              | Your apprentice cell                                   |
| Permissions           | Wards and seals                                        |
| root / sudo           | The Archivist's authority (currently usurped by lionX) |
| Process               | A spirit at work                                       |
| Pipe `\|`             | An aqueduct channel                                    |
| Shell script          | A ritual inscribed in a scroll                         |
| man page              | The Grimoire                                           |

Every command keeps its real name. The fantasy lives in the flavor text, the world, and Quill's
commentary, never in renamed commands.

## Act breakdown

Nine acts, each a wing of the Archive. Each act has 3 to 6 small lessons and ends with a capstone
puzzle.

| Act                 | Wing             | Commands and concepts                                                      | Capstone puzzle                                                                              |
| ------------------- | ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. The Awakening    | Apprentice Cells | `pwd`, `ls`, `cd`, absolute vs relative paths, `~`, `..`, tab completion   | Find your way from your cell to the Atrium using only paths Quill describes in riddles       |
| 2. The Reading Room | Reading Room     | `cat`, `less`, `head`, `tail`, `ls -a`, `ls -l`, `man`, `--help`           | Read the last lines of the Archivist's journal and uncover a sealed tome hidden in a dotfile |
| 3. The Binding      | Bindery          | `mkdir`, `mkdir -p`, `touch`, `cp`, `mv`, `rm`, `rmdir`, wildcards `*` `?` | Rebuild a collapsed shelf: create a nested directory tree and sort scattered pages into it   |
| 4. The Scrying      | Observatory      | `find`, `grep`, `grep -r`, `grep -i`, `wc`, `sort`, `uniq`                 | Locate every page mentioning the Archivist's true name across the whole wing                 |
| 5. The Channels     | Aqueducts        | `\|`, `>`, `>>`, `<`, `2>`, chaining with `&&`                             | Build a pipeline that filters lionX's noise and writes the clean record to a file            |
| 6. The Wards        | Vault            | `whoami`, `chmod` (symbolic and octal), `chown`, `sudo`, reading `rwx`     | Unseal the Vault by fixing permissions without opening it to everyone                        |
| 7. The Spirits      | Haunted Stacks   | `ps`, `top`, `kill`, `kill -9`, `&`, `jobs`, `fg`, `bg`                    | Find and banish the spirit hogging the stacks without killing the friendly ones              |
| 8. The Foundation   | Undercroft       | `echo`, env variables, `PATH`, `export`, `alias`, `.bashrc`, `which`       | Restore your lost spellbook by fixing PATH so a missing command works again                  |
| 9. The Last Ritual  | The Root         | shell scripts, shebang, `chmod +x`, variables, a simple loop, cron intro   | Write and run the ritual script that stops lionX and restores the Archive                    |

**Lesson structure:** Quill introduces a spell in one or two lines, the player tries it in a safe
pocket of the world, then a small task requires using it. Hints escalate in three steps: a nudge,
the command name, then the full syntax.

**Free play:** After Act 9, the whole Archive stays open as a sandbox, plus optional side quests
(`tar`, `ssh` flavor, `sed`, `diff`) for a possible post-game.

### Open questions

- Should vim or nano get a lesson, or is `echo >` enough for writing scripts?
- Does Act 6 need a second user account to make `chown` meaningful? (Tentative: yes, `lionx` is
  that account.)

## Progression loop

Every wing follows the same loop: Quill teaches a spell step by step, the player practices it on
repeatable restoration work, then proves mastery to open the next part of the Archive. "Act" and
"wing" are design terms only; the player never sees them.

1. **Learn (hand-holding).** Quill walks through one spell at a time. Early steps tell the player
   exactly what to type, then fade to describing the goal, then just pointing at the problem.
   Mistakes get gentle, specific feedback ("`cd` needs a place to go. Try `cd atrium`.").
2. **Practice (the grind).** The Corruption keeps creeping back, so there is always restoration
   work: re-shelve scattered pages, find a misplaced scroll, banish a minor spirit, mend a broken
   ward. These duties are generated from templates with randomized names, paths, and contents, so
   no two are identical. They use only spells the player knows, and mix in older spells so skills
   stay sharp.
3. **Prove (the gate).** Each spell has a mastery level that rises with clean, unassisted uses and
   drops slightly with hint use. When the wing's spells reach the threshold, the capstone appears:
   a larger story puzzle combining everything.
4. **Unlock.** Solving it opens the way forward in-world. A sealed door dissolves, a staircase
   rebuilds, Quill remembers a new piece of the Archivist's story. The next wing simply appears in
   `ls` output.

### Keeping the grind fun

- Adaptive length: players who solve duties fast and without hints reach the gate in a few tasks;
  struggling players get more practice at an easier difficulty.
- Rewards for duties: lore fragments, ASCII art trophies for your cell, cosmetic terminal themes,
  and Quill banter.
- Speed and efficiency bonuses: fewer keystrokes or a clever pipe earns a "swift casting" note.
- Duties stay available after unlocking. A daily duty board can come later.
- In-world progress cues: a `status` spell shows mastery as flavor text ("Your grasp of grep grows
  steady") rather than percentages, and the apprentice cell gains decorations as the player grows.

## Look and feel

The entire screen is a terminal. There are no menus, buttons, or HUD outside of it; even the title
screen, settings, and save slots are terminal output.

### Terminal art

- Each wing opens with an ASCII art banner: a tower for the Observatory, arches for the Aqueducts,
  a locked door for the Vault.
- Capstone completions play a short animated ASCII scene (candles lighting, a shelf rebuilding line
  by line).
- Spirits in Act 7 appear as small ASCII creatures that drift across the screen while their
  processes run. lionX appears as its lion sigil.
- `cat` on certain books reveals illuminated-manuscript style art with a drop cap.
- Color themes: a default amber-on-black "candlelit" theme, plus green phosphor, parchment (light),
  and a high-contrast theme. Each wing can tint the accent color.
- Text effects: typewriter reveal for Quill's lines (skippable with any key or tap), a flicker when
  Corruption is near, and glitched characters in corrupted files and lionX's lines.
- Art pipeline: ASCII art lives in plain `.txt` files in the repo, loaded by name. Art has a narrow
  variant (40 columns) for phones and a wide variant (80+ columns) for larger screens.

## Mobile and tablet

Typing commands on a phone keyboard is the biggest usability risk. The fix is a custom key bar
above the system keyboard, styled as part of the terminal.

### Touch controls

- Symbol bar: one-tap keys for `/`, `-`, `|`, `>`, `~`, `.`, `*`, plus Tab, Ctrl, and up/down for
  history. Swipe the bar for a second page of symbols.
- Tap to insert: tapping a filename or directory in output pastes it at the cursor.
- Command chips: a row of spell chips for commands already learned. Chips never complete arguments.
- Long-press a command in Quill's text to open its Grimoire (`man`) entry.

### Layout

- Font size scales with screen width; target at least 40 columns on a phone in portrait.
- Landscape on phones and all tablets use the wide layout and wide art.
- Handle the on-screen keyboard resizing the viewport (use `visualViewport`).
- Disable autocorrect, autocapitalize, and smart quotes on the input.

### Other

- Installable as a PWA so it runs full-screen and offline.
- Progress saves to local storage automatically after each lesson.
- Accessibility: screen-reader friendly output mode that skips ASCII art and announces new lines,
  plus a reduced-motion setting.

## Architecture

A React + TypeScript app built with Vite, using xterm.js for the terminal and a pure TypeScript
engine with no UI dependencies. The engine runs headless so every command and puzzle can be unit
tested.

| Module        | Responsibility                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `vfs`         | In-memory filesystem: inodes, directories, files, permissions, owners, hidden files, symlinks (later). Serializable to JSON for saves. |
| `shell`       | Tokenizer and parser: quoting, globbing, pipes, redirection, `&&`, `&`, env variable expansion. Produces a command AST.                |
| `commands`    | One plugin per command, registered by name. Each takes args, stdin, and a context, returns stdout, stderr, and exit code.              |
| `processes`   | Fake process table for `ps`, `kill`, jobs, spirits, and lionX. Ticks on a game clock.                                                  |
| `content`     | Acts, lessons, dialogue, starting filesystem per wing, and ASCII art, all as data files.                                               |
| `validator`   | Checks world state against each puzzle's goal predicates.                                                                              |
| `narrative`   | Quill's dialogue triggers, hint escalation, and story beats tied to events.                                                            |
| `progression` | Duty generation, per-spell mastery, gating.                                                                                            |
| `ui`          | xterm.js wrapper, themes, effects, mobile key bar, tap-to-insert, responsive layout.                                                   |
| `save`        | Auto-save and load to local storage, versioned.                                                                                        |

### Command plugin shape

```ts
interface Command {
  name: string;
  unlockedInAct: number;
  manPage: string;
  run(args: string[], io: IO, ctx: ShellContext): Promise<number>;
}
```

**Validation example:** the Act 3 capstone passes when `/bindery/shelf/fiction/tales` is a directory
and contains at least the three named pages, however the player got there.

**Out of scope for v1:** a real Linux kernel, networking, real text editors, user accounts beyond
`apprentice`, `archivist`, and `lionx`.

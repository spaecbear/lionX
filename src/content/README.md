# Writing content

Everything the player reads lives here as data. No TypeScript changes are needed to add a wing.

| Path | What |
| --- | --- |
| `wings/<id>.yaml` | A wing: its starting world, lessons, Quill's lines, goals, hints. |
| `coaching.yaml` | Quill's replies to common mistakes, shared by all wings. |
| `art/<name>.narrow.txt`, `art/<name>.wide.txt` | ASCII art, max 40 and 80 columns. |
| `grimoire/<spell>.txt` | The `man` page for a spell. |
| `help/<spell>.txt` | The `--help` text for a spell. |

`npm test` checks every wing loads, every art piece has both variants within width, and the
player-text rules (no em dashes; never say "act", "level", or "area").

## Wing format

```yaml
id: lantern-hall            # must match the file name
banner: lantern             # art/lantern.{narrow,wide}.txt
world:                      # starting filesystem
  user: { name: apprentice, groups: [apprentice], home: /home/apprentice }
  dirs: [/archive/hall, { path: /vault, mode: '700', owner: lionx, group: lionx }]
  files:
    /home/apprentice/note.txt: "text\n"
    /vault/seal: { content: "x", owner: lionx, mode: '600' }
intro: ["Quill's opening lines"]
lessons:
  - id: where-am-i
    spells: [pwd, ls]
    setup: { files: { ... } }   # optional: added when the lesson starts
    intro: [...]
    steps:
      - id: pwd
        guide: exact            # exact | goal | problem (most hands-off level used)
        guidance:               # write every level up to `guide`
          exact: 'Type `pwd` and press Enter.'
          goal: 'Find out where you stand.'
          problem: 'You are lost.'
        hints:                  # exactly three: nudge, the spell, full syntax
          - 'Ask the Lexicon where you are.'
          - 'The spell is `pwd`.'
          - 'Type exactly: pwd'
        goal: { ran: pwd }      # see goals below
        success: ['Quill reacts']
        coaching:               # optional, checked before the shared rules
          - { line: '^\s*ls\s*$', say: 'Try asking for all of them.' }
    outro: [...]
outro: [...]
```

Text in `backticks` is shown highlighted as a spell. If the player needed hints on a step, Quill
uses one level more explicit guidance on the next step.

## Goals

Goals check the world, not the exact command typed, so any valid solution wins.

| Goal | True when |
| --- | --- |
| `exists: path` / `missing: path` | the path exists / does not |
| `isDir: path` / `isFile: path` | it is a directory / a file |
| `contains: { path, text }` or `{ path, pattern }` | the file has that text / matches the regex |
| `mode: { path, mode: '640' }` | permission bits equal |
| `owner: { path, owner, group }` | owner and/or group equal |
| `cwdIs: path` | the player stands there |
| `processRunning: name` | that process is running (from the Haunted Stacks on) |
| `ran: spell` or `{ command, args, status }` | a spell was cast successfully this step (for spells that change nothing) |
| `read: path` | the file was read this step, by any spell |
| `all: [...]`, `any: [...]`, `not: goal` | combinations |

Goals are checked with full access, so wards the player cannot pass don't hide the answer.

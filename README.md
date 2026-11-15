# Archive of Echoes

A browser game that teaches the Linux command line through a fantasy story. The whole game is a
terminal: every room in the magical Archive is a directory, every book a file, every spirit a
process, and every command a spell, with its real name and real behavior. Quill, a sardonic
familiar, guides a new apprentice through nine wings of the Archive to face lionX, the runaway
guardian process that has taken the Archive's root.

Commands match GNU coreutils and Bash closely (output formats, error messages, exit codes), so
everything a player learns works on a real Linux machine.

## Play

```bash
npm install
npm run dev
```

Open the address Vite prints. On the title screen, `play 1` starts (or continues) save slot 1.
Inside the Archive: `hint` for help, `status` for progress, `duty` for practice work, `settings`
for themes, motion, and screen-reader mode, and `exit` to save and return to the title.

Add `?touch=1` to the address to see the phone controls on a desktop. To try it on a phone on the
same network: `npm run dev -- --host`.

## Test

```bash
npm test        # engine, content, and UI tests, including a scripted full playthrough
npm run lint
npm run e2e     # real-browser checks (desktop and 375px touch); needs Playwright + Chromium
```

`npm test` includes a player who follows only Quill's last hint for every step and finishes the
whole game, so a broken instruction anywhere in the content fails the build.

## Deploy

One manual GitHub Actions workflow publishes to GitHub Pages. Enable Pages with Source "GitHub
Actions" in the repository settings, then run "Deploy to GitHub Pages" from the Actions tab. It
never runs on its own.

## Write content

All lessons, dialogue, worlds, duties, and art are data in `src/content`. See
[src/content/README.md](src/content/README.md). Design: [docs/DESIGN.md](docs/DESIGN.md). Plan:
[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

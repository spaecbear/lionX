/**
 * Browser smoke test: builds nothing itself; run via `npm run e2e`, which
 * builds first. Serves dist/ with `vite preview`, drives real Chromium at
 * desktop width and at 375px with touch, and fails on any broken behavior or
 * console error. Needs Playwright with Chromium installed.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error(
    'Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium',
  );
  process.exit(2);
}

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const screenText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.xterm-rows > div')]
      .map((d) => d.textContent.replace(/\u00a0/g, ' ').trimEnd())
      .join('\n'),
  );

async function run(label, contextOptions) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const k = page.keyboard;
  const cmd = async (line) => {
    await k.press('Escape'); // finish any of Quill's lines
    await k.type(line);
    await k.press('Enter');
    await page.waitForTimeout(350);
    await k.press('Escape');
    await page.waitForTimeout(100);
  };

  await page.goto(URL);
  await page.waitForTimeout(600);
  check(
    (await screenText(page)).includes('lexicon>'),
    `${label}: title screen shows the lexicon> prompt`,
  );
  check((await screenText(page)).includes('(empty)'), `${label}: title screen lists save slots`);

  await cmd('play 1');
  await page.waitForTimeout(500);
  check((await screenText(page)).includes('Quill:'), `${label}: Quill speaks at the start`);

  await cmd('pwd');
  check(
    (await screenText(page)).includes('\n/home/apprentice\n'),
    `${label}: command output reaches the screen (pwd)`,
  );
  await cmd('ls');
  check((await screenText(page)).includes('cell-rules.txt'), `${label}: ls lists the cell`);
  await cmd('cat cell-rules.txt');
  check(
    (await screenText(page)).includes("cat: You don't know that spell yet."),
    `${label}: locked spells answer in-world`,
  );

  await k.press('Escape');
  await k.type('ls an');
  await k.press('Tab');
  await page.waitForTimeout(200);
  // Long lines wrap on a phone; compare with rows joined.
  check(
    (await screenText(page))
      .replace(/\n/g, '')
      .includes('ls an-unreasonably-long-corridor-that-goes-nowhere/'),
    `${label}: Tab completes paths`,
  );
  await k.press('Control+U');

  if (contextOptions.hasTouch) {
    check((await page.locator('.keybar .key').count()) > 0, `${label}: touch key bar is shown`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check(width <= contextOptions.viewport.width, `${label}: no horizontal scrolling`);
  }

  await page.reload();
  await page.waitForTimeout(600);
  check(
    /1 {2}apprentice-cells/.test(await screenText(page)),
    `${label}: the save survives a reload`,
  );
  await cmd('play 1');
  await page.waitForTimeout(400);
  check(
    (await screenText(page)).includes('Back again'),
    `${label}: resuming welcomes the player back`,
  );

  check(
    errors.length === 0,
    `${label}: no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`,
  );
  await browser.close();
}

try {
  await waitForServer();
  await run('desktop', { viewport: { width: 1100, height: 800 } });
  await run('phone 375', {
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall browser checks passed');
process.exit(failures.length ? 1 : 0);

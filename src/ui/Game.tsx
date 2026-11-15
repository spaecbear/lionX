import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createRegistry } from '../engine/commands';
import { Shell } from '../engine/shell';
import { loadCoaching, loadDuties, loadQuillLines, loadWing } from '../engine/content';
import {
  createDutyCommand,
  createHintCommand,
  createStatusCommand,
  LessonRunner,
} from '../engine/narrative';
import { artFor, coachingSource, dutySources, quillSource, wingSources } from '../content';

/** Spells of the Lexicon itself, always available, shown last among the chips. */
const LEXICON_SPELLS = ['hint', 'status', 'duty'];

/** The wing to play. Phase 9 replaces this sample with the real opening wings. */
const START_WING = 'lantern-hall';
const TYPE_DELAY_MS = 18;
import { TerminalController } from './terminal/controller';
import { candlelit, FONT_STACK } from './theme';
import { KeyBar } from './mobile/KeyBar';
import { Chips } from './mobile/Chips';
import { applyCtrl } from './mobile/input';
import type { BarKey } from './mobile/keys';
import { fontSizeFor, layoutFor, type Layout } from './mobile/layout';
import { tapInsertion, withSeparator, wordAt } from './mobile/tap';

const TAP_MAX_MOVE = 8; // px
const TAP_MAX_MS = 400;

/** Touch controls show on coarse pointers, or anywhere with ?touch=1 for testing. */
function wantsTouchControls(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true;
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Advance width of the terminal font as a fraction of its size. */
function measureCharRatio(): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0.6;
  ctx.font = `100px ${FONT_STACK}`;
  return ctx.measureText('M').width / 100 || 0.6;
}

interface Session {
  term: XTerm;
  fit: FitAddon;
  controller: TerminalController;
  shell: Shell;
}

/** The whole game: the terminal, plus touch controls styled as part of it. */
export function Game() {
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const ctrlArmed = useRef(false);
  const [ctrlShown, setCtrlShown] = useState(false);
  const [touch] = useState(wantsTouchControls);
  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  const [commands, setCommands] = useState<string[]>([]);

  const setCtrl = (on: boolean) => {
    ctrlArmed.current = on;
    setCtrlShown(on);
  };

  /** Send input to the shell, applying a pending on-screen Ctrl. */
  const send = useCallback((data: string) => {
    const s = session.current;
    if (!s) return;
    if (ctrlArmed.current) {
      setCtrl(false);
      const ctrl = applyCtrl(data);
      if (ctrl !== null) data = ctrl;
    }
    void s.controller.handleData(data);
  }, []);

  /** Insert text at the cursor with a separating space if needed. */
  const insert = useCallback(
    (text: string) => {
      const s = session.current;
      if (!s) return;
      const before = s.controller.line.text.slice(0, s.controller.line.cursor);
      send(withSeparator(text, before));
      s.term.focus();
    },
    [send],
  );

  useEffect(() => {
    const el = host.current!;
    const charRatio = measureCharRatio();
    const term = new XTerm({
      theme: candlelit,
      fontFamily: FONT_STACK,
      fontSize: 16,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // Phone keyboards must not "fix" commands.
    const ta = el.querySelector('textarea');
    if (ta) {
      for (const [k, v] of Object.entries({
        autocorrect: 'off',
        autocapitalize: 'off',
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'enter',
        'aria-label': 'Lexicon input',
      })) {
        ta.setAttribute(k, v);
      }
    }

    const runner = new LessonRunner(loadWing(wingSources[START_WING], `${START_WING}.yaml`), {
      coaching: loadCoaching(coachingSource),
      dutyFiles: Object.fromEntries(
        Object.entries(dutySources).map(([id, src]) => [id, loadDuties(src, `${id}.yaml`)]),
      ),
      lines: loadQuillLines(quillSource),
    });
    const vfs = runner.vfs;
    const registry = createRegistry().register(
      createHintCommand(() => runner),
      createStatusCommand(() => runner),
      createDutyCommand(() => runner),
    );
    const shell = new Shell({
      vfs,
      registry,
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      env: { USER: vfs.credentials.user, PWD: vfs.cwd, TERM: 'xterm-256color' },
      onCommandRun: (name, args, status) => runner.recordCommand(name, args, status),
      isUnlocked: (cmd) => cmd.unlockedInAct === 0 || runner.knows(cmd.name),
    });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const controller = new TerminalController(term, shell, {
      narrator: runner,
      // Chips grow as lessons teach new spells.
      onCommand: () => setCommands([...runner.known, ...LEXICON_SPELLS]),
      artFor,
      typeDelay: reducedMotion ? 0 : TYPE_DELAY_MS,
    });
    session.current = { term, fit, controller, shell };
    // Known spells are set when the opening narration is produced.
    queueMicrotask(() => setCommands([...runner.known, ...LEXICON_SPELLS]));

    const resize = () => {
      const vv = window.visualViewport;
      const height = vv?.height ?? window.innerHeight;
      // Size the game to the visible viewport, so the on-screen keyboard never covers the prompt.
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      document.documentElement.style.setProperty('--app-top', `${vv?.offsetTop ?? 0}px`);
      const width = el.clientWidth - 20; // minus horizontal padding
      setLayout(layoutFor(window.innerWidth));
      const size = fontSizeFor(width, charRatio);
      if (term.options.fontSize !== size) term.options.fontSize = size;
      fit.fit();
      shell.env.set('COLUMNS', String(term.cols));
      shell.env.set('LINES', String(term.rows));
      term.scrollToBottom();
    };
    resize();
    void controller.start();

    const sub = term.onData((d) => send(d));
    term.focus();

    // Tap a filename or directory in the output to insert it at the cursor.
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start) return;
      controller.skipSpeech(); // a tap finishes Quill's sentence
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved > TAP_MAX_MOVE || performance.now() - start.t > TAP_MAX_MS) return;
      if (term.hasSelection()) return;
      const screen = el.querySelector('.xterm-screen')?.getBoundingClientRect();
      if (!screen) return;
      const col = Math.floor(((e.clientX - screen.left) / screen.width) * term.cols);
      const row = Math.floor(((e.clientY - screen.top) / screen.height) * term.rows);
      const buf = term.buffer.active;
      const line = buf.getLine(buf.viewportY + row)?.translateToString(true) ?? '';
      const hit = wordAt(line, col);
      const text = hit && tapInsertion(hit.word, shell.vfs);
      if (text) insert(text);
    };
    el.addEventListener('pointerdown', onDown, true); // capture: xterm stops bubbling
    el.addEventListener('pointerup', onUp, true);

    // In a pager (alternate screen), vertical swipes scroll by sending arrow keys.
    let swipeY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      swipeY = term.buffer.active.type === 'alternate' ? e.touches[0].clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (swipeY === null || term.buffer.active.type !== 'alternate') return;
      e.preventDefault();
      const rowHeight = el.clientHeight / term.rows;
      const dy = e.touches[0].clientY - swipeY;
      const steps = Math.trunc(dy / rowHeight);
      if (steps === 0) return;
      swipeY += steps * rowHeight;
      // Finger moves up = read further down, like scrolling a page.
      send((steps < 0 ? '\x1b[B' : '\x1b[A').repeat(Math.abs(steps)));
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);

    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      sub.dispose();
      term.dispose();
      session.current = null;
    };
  }, [send, insert]);

  const onBarKey = (k: BarKey) => {
    if (k.send === 'ctrl') setCtrl(!ctrlArmed.current);
    else send(k.send);
    session.current?.term.focus();
  };

  return (
    <div className="game" data-layout={layout} data-touch={touch ? 'on' : 'off'}>
      <div ref={host} className="terminal-host" aria-label="Archive terminal" />
      {touch && (
        <div className="touch-controls">
          <Chips commands={commands} onChip={(name) => insert(name + ' ')} />
          <KeyBar ctrlArmed={ctrlShown} onKey={onBarKey} />
        </div>
      )}
    </div>
  );
}

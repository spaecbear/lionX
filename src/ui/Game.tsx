import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Shell } from '../engine/shell';
import { browserStorage } from '../engine/save';
import { artFor } from '../content';
import { loadGameContent } from '../content/game';
import titleHelp from '../content/title.txt?raw';
import { Director } from './director';
import musicYaml from '../content/music.yaml?raw';
import { loadMusic, moodFor } from './audio/compose';
import { LofiPlayer } from './audio/lofi';

const TYPE_DELAY_MS = 18;
import { ALWAYS_AVAILABLE, FONT_STACK, THEMES, WING_TINTS } from './theme';
import { loadSettings, saveSettings } from './settings';
import type { Settings } from '../engine/settings';
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
  director: Director;
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
  const [themeName, setThemeName] = useState('candlelit');

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
    void s.director.handleData(data);
  }, []);

  /** Insert text at the cursor with a separating space if needed. */
  const insert = useCallback(
    (text: string) => {
      const s = session.current;
      if (!s) return;
      const line = s.director.controller.line;
      const before = line.text.slice(0, line.cursor);
      send(withSeparator(text, before));
      s.term.focus();
    },
    [send],
  );

  useEffect(() => {
    const el = host.current!;
    const charRatio = measureCharRatio();
    const term = new XTerm({
      theme: THEMES[loadSettings().theme] ?? THEMES.candlelit,
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

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let settings = loadSettings();
    /** Motion and reader mode, from settings (and the device for motion: auto). */
    const behavior = (st: Settings) => {
      const still = st.reader || st.motion === 'off' || (st.motion === 'auto' && prefersReduced);
      return {
        typeDelay: still ? 0 : TYPE_DELAY_MS,
        animateSpirits: !still,
        // Screen readers get words, not pictures.
        artFor: st.reader ? () => undefined : artFor,
      };
    };
    const applyLook = (st: Settings) => {
      term.options.theme = THEMES[st.theme] ?? THEMES.candlelit;
      term.options.screenReaderMode = st.reader;
      setThemeName(st.theme);
    };
    applyLook(settings);
    const music = loadMusic(musicYaml);
    const player = new LofiPlayer(music);
    // Browsers allow sound only after a key press or tap, so the music starts on the first one.
    let heard = false;
    const applyMusic = (st: Settings) => {
      player.setVolume(st.volume / 10);
      if (st.music && st.volume > 0 && heard && !document.hidden) player.start();
      else player.stop();
    };
    const onGesture = () => {
      if (heard) return;
      heard = true;
      applyMusic(settings);
    };
    const onVisibility = () => applyMusic(settings);
    window.addEventListener('keydown', onGesture, true);
    window.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('visibilitychange', onVisibility);
    let shell: Shell | null = null;
    const director = new Director(term, {
      storage: browserStorage(),
      content: loadGameContent(),
      ...behavior(settings),
      settings: {
        get: () => settings,
        set: (next) => {
          settings = next;
          saveSettings(next);
          applyLook(next);
          applyMusic(next);
          director.configure(behavior(next));
        },
        themes: Object.keys(THEMES),
        alwaysAvailable: ALWAYS_AVAILABLE,
      },
      wingTints: WING_TINTS,
      onWing: (id) => player.setMood(moodFor(music, id)),
      titleHelp,

      onChips: setCommands,
      onShell: (sh) => {
        shell = sh;
        sh.env.set('COLUMNS', String(term.cols));
        sh.env.set('LINES', String(term.rows));
      },
    });
    session.current = { term, fit, director };

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
      shell?.env.set('COLUMNS', String(term.cols));
      shell?.env.set('LINES', String(term.rows));
      term.scrollToBottom();
    };
    resize();
    director.showTitle();

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
      director.controller.skipSpeech(); // a tap finishes Quill's sentence
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
      const text = hit && shell && tapInsertion(hit.word, shell.vfs);
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
      window.removeEventListener('keydown', onGesture, true);
      window.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      player.stop();
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
    <div
      className="game"
      data-layout={layout}
      data-touch={touch ? 'on' : 'off'}
      data-theme={themeName}
    >
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

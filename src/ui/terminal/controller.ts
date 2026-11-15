import { complete, parse, ShellSyntaxError, type Shell } from '../../engine/shell';
import { History } from './history';
import { KEY, splitKeys } from './keys';
import { LineBuffer } from './lineBuffer';
import { normalizeSmartPunctuation } from '../mobile/input';
import type { Narration } from '../../engine/narrative';
import { QUILL_SGR, renderBreakdown, renderQuill } from './narration';

/** The part of xterm.js the controller needs, so tests can use a fake. */
export interface TerminalLike {
  write(data: string): void;
  readonly cols: number;
  readonly rows: number;
}

export interface ControllerOptions {
  /** Shown once at startup, before the first prompt. */
  motd?: string;
  hostname?: string;
  history?: string[];
  /** Called after each submitted line, e.g. to persist history. */
  onCommand?: (line: string, status: number) => void;
  /** Story and lessons: what Quill says at the start and after each command. */
  narrator?: Narrator;
  /** Art text by name for the current width. */
  artFor?: (name: string, cols: number) => string | undefined;
  /** Color code for the path in the prompt (each wing tints it). */
  accent?: string;
  /** A fixed prompt instead of user@host:path$ (the title screen uses one). */
  prompt?: string;
  /** Draw running spirits drifting across the top row while the prompt is idle. */
  animateSpirits?: boolean;
  /** Milliseconds per character of Quill's typewriter. 0 prints instantly. */
  typeDelay?: number;
}

export interface Narrator {
  start(): Narration[];
  afterCommand(line: string, status: number, stderr: string): Narration[];
}

const SGR = {
  reset: '\x1b[0m',
  userHost: '\x1b[1;33m',
  path: '\x1b[93m',
};
const CLEAR_SCREEN = '\x1b[H\x1b[2J';

/**
 * Turns raw keystrokes into an editable command line, draws the Bash-style
 * prompt, and hands complete lines to the shell. Knows nothing about the DOM.
 *
 * Redrawing: the controller remembers where on screen the cursor sits
 * relative to the start of the prompt, so it can jump back there, erase to the
 * end of the screen, and repaint the prompt and line, even when the line wraps.
 */
export class TerminalController {
  readonly line = new LineBuffer();
  readonly history: History;
  private pending = '';
  private busy = false;
  private queue: string[] = [];
  private drain: Promise<void> = Promise.resolve();
  private keyReader: ((key: string) => void) | null = null;
  private idleWaiters: (() => void)[] = [];
  /** Cursor offset (in cells) from the start of the prompt, as last drawn. */
  private drawnOffset = 0;
  private hostname: string;
  /** Tail of recent command output, to know whether it ended on a fresh line. */
  private outputTail = '\n';
  /** Error output of the running command, for Quill's coaching. */
  private stderrText = '';
  /** True while Quill is mid-sentence; any key finishes the sentence instantly. */
  private speaking = false;
  private skipSpeechFlag = false;
  /** Once the player starts typing ahead, Space and Enter are part of the command. */
  private typedDuringSpeech = false;

  constructor(
    private term: TerminalLike,
    private shell: Shell,
    private opts: ControllerOptions = {},
  ) {
    this.history = new History(opts.history);
    this.hostname = opts.hostname ?? 'archive';
    const out = { write: (s: string) => this.writeOutput(s) };
    const err = {
      write: (s: string) => {
        this.stderrText += s;
        this.writeOutput(s);
      },
    };
    shell.terminal = { stdout: out, stderr: err };
    shell.tty = {
      get rows() {
        return term.rows;
      },
      get cols() {
        return term.cols;
      },
      readKey: () => this.readKey(),
      pollKey: (ms: number) => this.pollKey(ms),
    };
  }

  private writeOutput(s: string) {
    if (!s) return;
    this.outputTail = (this.outputTail + s).slice(-16);
    this.term.write(s.replace(/\r?\n/g, '\r\n'));
  }

  /** Finish Quill's current lines at once (for taps on touch screens). */
  skipSpeech(): void {
    if (this.speaking) this.skipSpeechFlag = true;
  }

  private spiritTimer: ReturnType<typeof setInterval> | null = null;
  private spiritCells: { col: number; len: number }[] = [];

  /** Change options on the fly (settings, wing tints). */
  configure(change: Partial<ControllerOptions>): void {
    Object.assign(this.opts, change);
    if (change.animateSpirits === false) this.dispose();
    if (change.animateSpirits) this.startSpirits();
  }

  /** Start the spirit drift (call once; stop with dispose()). */
  startSpirits(intervalMs = 350): void {
    if (!this.opts.animateSpirits || this.spiritTimer) return;
    this.spiritTimer = setInterval(() => this.drawSpirits(Date.now()), intervalMs);
  }

  dispose(): void {
    if (this.spiritTimer) clearInterval(this.spiritTimer);
    this.spiritTimer = null;
  }

  /**
   * Draw each running spirit's glyph on the top row, moving with time. Only
   * while idle at a prompt; the cursor is saved and restored around it.
   */
  drawSpirits(now: number): void {
    if (this.busy || this.speaking || this.pending) return;
    const spirits = (this.shell.processes?.list() ?? []).filter((p) => p.spirit && p.state !== 'T');
    if (spirits.length === 0 && this.spiritCells.length === 0) return;
    const cols = this.term.cols;
    let out = '\x1b7';
    for (const c of this.spiritCells) out += `\x1b[1;${c.col + 1}H${' '.repeat(c.len)}`;
    this.spiritCells = [];
    spirits.forEach((p, i) => {
      const glyph = p.spirit!;
      const span = Math.max(1, cols - glyph.length);
      const speed = 120 + ((p.pid * 37) % 200);
      const col = Math.floor(now / speed + i * (span / spirits.length)) % span;
      out += `\x1b[1;${col + 1}H\x1b[2;33m${glyph}\x1b[0m`;
      this.spiritCells.push({ col, len: glyph.length });
    });
    this.term.write(out + '\x1b8');
  }

  /** Print the welcome, then Quill's opening, then the first prompt. */
  start(): Promise<void> {
    if (this.opts.motd) this.writeOutput(wrapText(this.opts.motd, this.term.cols));
    const opening = this.opts.narrator?.start() ?? [];
    if (opening.length === 0) {
      this.showPrompt();
      return Promise.resolve();
    }
    const done = this.present(opening).then(() => this.showPrompt());
    this.drain = this.drain.then(() => done);
    return done;
  }

  /** Show art and Quill's lines. Quill types; a keypress finishes the current batch at once. */
  private async present(items: Narration[]): Promise<void> {
    const delay = this.opts.typeDelay ?? 0;
    this.speaking = true;
    this.skipSpeechFlag = false;
    this.typedDuringSpeech = false;
    try {
      for (const item of items) {
        if (item.kind === 'art') {
          const art = this.opts.artFor?.(item.name, this.term.cols);
          if (art) {
            const lines = art.replace(/\n+$/, '').split('\n');
            if (item.reward && delay > 0 && !this.skipSpeechFlag) {
              // Reward art draws in line by line, like a lamp catching; a key finishes it.
              this.term.write('\r\n');
              for (let i = 0; i < lines.length; i++) {
                if (this.skipSpeechFlag) {
                  this.term.write(
                    QUILL_SGR.reward + lines.slice(i).join('\r\n') + QUILL_SGR.reset + '\r\n',
                  );
                  break;
                }
                this.term.write(QUILL_SGR.reward + lines[i] + QUILL_SGR.reset + '\r\n');
                await new Promise((r) => setTimeout(r, delay * 3));
              }
              this.term.write('\r\n');
            } else {
              const color = item.reward ? QUILL_SGR.reward : QUILL_SGR.art;
              this.term.write(
                (item.reward ? '\r\n' : '') +
                  color +
                  lines.join('\r\n') +
                  QUILL_SGR.reset +
                  '\r\n\r\n',
              );
            }
          }
        } else if (item.kind === 'achievement') {
          this.term.write(
            `\r\n  ${QUILL_SGR.reward}* Achievement: ${item.title}${QUILL_SGR.reset}\r\n` +
              `    ${QUILL_SGR.narrator}${item.says}${QUILL_SGR.reset}\r\n\r\n`,
          );
        } else if (item.kind === 'breakdown') {
          this.term.write(renderBreakdown(item.command, item.pieces, this.term.cols));
        } else if (item.kind === 'quill' || item.kind === 'narrator') {
          const pieces = renderQuill(
            item.text,
            this.term.cols,
            item.kind === 'narrator' ? 'narrator' : 'quill',
          );
          if (delay <= 0 || this.skipSpeechFlag) {
            this.term.write(pieces.join(''));
          } else {
            for (let i = 0; i < pieces.length; i++) {
              if (this.skipSpeechFlag) {
                this.term.write(pieces.slice(i).join(''));
                break;
              }
              this.term.write(pieces[i]);
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }
      }
    } finally {
      this.speaking = false;
    }
  }

  /** Feed raw terminal input (from xterm onData). Resolves when it has been processed. */
  handleData(data: string): Promise<void> {
    if (this.speaking) {
      // Any key finishes Quill's sentence at once. Pure "skip" keys stop there;
      // anything else is kept, so typing ahead works.
      this.skipSpeechFlag = true;
      const pureSkip = data === ' ' || data === '\r' || data === '\x1b';
      if (pureSkip && !this.typedDuringSpeech) return this.drain;
      this.typedDuringSpeech = true;
    }
    this.queue.push(...splitKeys(normalizeSmartPunctuation(data)));
    this.drain = this.drain.then(() => this.processQueue());
    this.wakeReader();
    // Settle when everything is processed, or when a running program is waiting for more keys.
    return Promise.race([this.drain, new Promise<void>((r) => this.idleWaiters.push(r))]);
  }

  /** Keys for interactive programs (pagers) while a command runs. */
  private readKey(): Promise<string> {
    const key = this.queue.shift();
    if (key !== undefined) return Promise.resolve(key);
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((w) => w());
    return new Promise((r) => (this.keyReader = r));
  }

  /** Like readKey, but gives up after `ms` (programs that also watch the clock, like top). */
  private pollKey(ms: number): Promise<string | null> {
    const key = this.queue.shift();
    if (key !== undefined) return Promise.resolve(key);
    this.idleWaiters.splice(0).forEach((w) => w());
    return new Promise((resolve) => {
      const reader = (k: string) => {
        clearTimeout(timer);
        resolve(k);
      };
      const timer = setTimeout(() => {
        if (this.keyReader === reader) this.keyReader = null;
        resolve(null);
      }, ms);
      this.keyReader = reader;
    });
  }

  private wakeReader() {
    if (!this.keyReader || this.queue.length === 0) return;
    const r = this.keyReader;
    this.keyReader = null;
    r(this.queue.shift()!);
  }

  /** Plain-text prompt, e.g. `apprentice@archive:~$ ` or `> ` for continuation lines. */
  promptText(): string {
    if (this.pending) return '> ';
    if (this.opts.prompt !== undefined) return this.opts.prompt;
    return `${this.userHost()}:${this.displayCwd()}${this.sigil()} `;
  }

  private userHost() {
    return `${this.shell.vfs.credentials.user}@${this.hostname}`;
  }

  private sigil() {
    return this.shell.vfs.isRoot ? '#' : '$';
  }

  private displayCwd(): string {
    const cwd = this.shell.vfs.cwd;
    const home = this.shell.env.get('HOME') ?? this.shell.vfs.home;
    if (home !== '/' && (cwd === home || cwd.startsWith(home + '/'))) {
      return '~' + cwd.slice(home.length);
    }
    return cwd;
  }

  private coloredPrompt(): string {
    if (this.pending) return '> ';
    if (this.opts.prompt !== undefined) return `${SGR.userHost}${this.opts.prompt}${SGR.reset}`;
    return (
      `${SGR.userHost}${this.userHost()}${SGR.reset}:` +
      `${this.opts.accent ?? SGR.path}${this.displayCwd()}${SGR.reset}${this.sigil()} `
    );
  }

  /** Start a fresh prompt. The cursor must be at column 0. */
  private showPrompt() {
    this.line.set('');
    this.drawnOffset = 0;
    this.redraw();
  }

  private async processQueue() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        await this.handleKey(this.queue.shift()!);
      }
    } finally {
      this.busy = false;
    }
  }

  private async handleKey(key: string) {
    const L = this.line;
    const is = (k: string | readonly string[]) =>
      typeof k === 'string' ? k === key : k.includes(key);

    if (key === KEY.ENTER || key === KEY.LF) return this.submit();
    if (key === KEY.CTRL_C) return this.interrupt();
    if (key === KEY.CTRL_L) {
      this.term.write(CLEAR_SCREEN);
      this.drawnOffset = 0;
      return this.redraw();
    }
    if (key === KEY.TAB) return this.tab();
    if (key === KEY.UP || key === KEY.CTRL_P) {
      const prev = this.history.up(L.text);
      if (prev !== null) L.set(prev);
    } else if (key === KEY.DOWN || key === KEY.CTRL_N) {
      const next = this.history.down();
      if (next !== null) L.set(next);
    } else if (key === KEY.BACKSPACE || key === KEY.CTRL_H) L.backspace();
    else if (key === KEY.DELETE) L.deleteForward();
    else if (key === KEY.CTRL_D) {
      // Bash exits on an empty line; the Lexicon cannot be closed, so do nothing there.
      L.deleteForward();
    } else if (key === KEY.LEFT) L.left();
    else if (key === KEY.RIGHT) L.right();
    else if (is(KEY.HOME)) L.home();
    else if (is(KEY.END)) L.end();
    else if (is(KEY.WORD_LEFT)) L.wordLeft();
    else if (is(KEY.WORD_RIGHT)) L.wordRight();
    else if (key === KEY.CTRL_U) L.killToStart();
    else if (key === KEY.CTRL_K) L.killToEnd();
    else if (key === KEY.CTRL_W) L.killWordBack();
    else if (key.startsWith('\x1b') || key < ' ')
      return; // unhandled control key
    else L.insert(key);
    this.redraw();
  }

  private interrupt() {
    this.line.end();
    this.redraw();
    this.term.write('^C\r\n');
    this.pending = '';
    this.history.resetCursor();
    this.shell.lastStatus = 130;
    this.showPrompt();
  }

  private async submit() {
    const typed = this.line.text;
    this.line.end();
    this.redraw();
    this.term.write('\r\n');

    const source = this.pending + typed;
    try {
      parse(source);
    } catch (e) {
      if (e instanceof ShellSyntaxError && e.incomplete) {
        this.pending = source + '\n';
        this.showPrompt();
        return;
      }
    }
    this.pending = '';
    this.history.add(source);

    this.outputTail = '\n';
    this.stderrText = '';
    const status = await this.shell.run(source);
    // Keep the prompt at column 0 so line redraws stay accurate (zsh does the same).
    const t = this.outputTail;
    if (
      !t.endsWith('\n') &&
      !t.endsWith('\x1b[2J') &&
      !t.endsWith('\x1b[3J') &&
      !t.endsWith('\x1b[?1049l')
    ) {
      this.term.write('\r\n');
    }
    this.opts.onCommand?.(source, status);
    const said = this.opts.narrator?.afterCommand(source, status, this.stderrText) ?? [];
    if (said.length) await this.present(said);
    this.showPrompt();
  }

  private tab() {
    const L = this.line;
    const result = complete(L.text, L.cursor, {
      vfs: this.shell.vfs,
      commands: this.shell.registry.names(),
      home: this.shell.env.get('HOME'),
    });
    const original = L.text.slice(result.start, L.cursor);
    if (result.replacement !== original) {
      L.replaceBeforeCursor(result.start, result.replacement);
      this.redraw();
      return;
    }
    if (result.candidates.length === 0) {
      this.term.write('\x07'); // bell
      return;
    }
    // Show the options below, then repaint the prompt and line.
    L.end();
    this.redraw();
    this.term.write('\r\n' + formatColumns(result.candidates, this.term.cols) + '\r\n');
    this.drawnOffset = 0;
    this.redraw();
  }

  /** Repaint prompt + line and place the cursor. Assumes one cell per character. */
  private redraw() {
    const cols = Math.max(1, this.term.cols);
    const promptLen = this.promptText().length;
    let out = '';
    // Jump back to the start of the prompt.
    const rowsUp = Math.floor(this.drawnOffset / cols);
    out += '\r' + (rowsUp > 0 ? `\x1b[${rowsUp}A` : '');
    // Newlines from recalled multi-line history show as one-cell ↵ glyphs.
    out += '\x1b[J' + this.coloredPrompt() + this.line.text.replace(/\n/g, '↵');
    const endOffset = promptLen + this.line.text.length;
    // At an exact multiple of cols the terminal waits to wrap; force the wrap.
    if (endOffset > 0 && endOffset % cols === 0) out += '\r\n';
    const target = promptLen + this.line.cursor;
    const endRow = Math.floor(endOffset / cols);
    const targetRow = Math.floor(target / cols);
    if (endRow > targetRow) out += `\x1b[${endRow - targetRow}A`;
    out += `\x1b[${(target % cols) + 1}G`;
    this.term.write(out);
    this.drawnOffset = target;
  }
}

/** Lay out names in columns like `ls`, filling down each column. */
export function formatColumns(names: string[], width: number): string {
  const colWidth = Math.max(...names.map((n) => n.length)) + 2;
  const perRow = Math.max(1, Math.floor(width / colWidth));
  const rows = Math.ceil(names.length / perRow);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < perRow; c++) {
      const name = names[c * rows + r];
      if (name === undefined) continue;
      line += name.padEnd(colWidth);
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\r\n');
}

/** Word-wrap prose to `width` columns so narrow screens don't split words. Long words are split. */
export function wrapText(text: string, width: number): string {
  if (width < 1) return text;
  return text
    .split('\n')
    .map((line) => {
      // Short lines are left exactly as written (art, aligned tables).
      if (line.length <= width) return line;
      const out: string[] = [];
      let cur = '';
      for (const word of line.split(' ')) {
        let w = word;
        while (w.length > width) {
          if (cur) out.push(cur);
          out.push(w.slice(0, width));
          w = w.slice(width);
          cur = '';
        }
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
        else {
          out.push(cur);
          cur = w;
        }
      }
      out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}

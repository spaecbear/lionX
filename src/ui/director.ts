import { createSession, type GameContent, type GameSession } from '../engine/session';
import {
  createTitleRegistry,
  describeSlot,
  readSlot,
  SLOT_COUNT,
  writeSlot,
  type SaveStorage,
} from '../engine/save';
import { Shell } from '../engine/shell';
import { createSettingsCommand, type Settings } from '../engine/settings';
import { Vfs } from '../engine/vfs';
import { createStoryCommand, STORY_END, STORY_LINES } from './story';
import { TerminalController, type TerminalLike } from './terminal/controller';

/** Spells of the Lexicon itself, always available, shown last among the chips. */
export const LEXICON_SPELLS = ['hint', 'status', 'duty'];
export const TITLE_CHIPS = ['play', 'slots', 'erase', 'help'];
export const TITLE_PROMPT = 'lexicon> ';

export interface DirectorOptions {
  storage: SaveStorage | null;
  content: GameContent;
  artFor: (name: string, cols: number) => string | undefined;
  titleHelp: string;
  typeDelay?: number;
  /** Spirits drift across the screen (off for reduced motion). */
  animateSpirits?: boolean;
  now?: () => number;
  /** The chips the touch layer should show right now. */
  onChips?: (names: string[]) => void;
  /** Preferences: read, save, and which themes exist. */
  settings?: {
    get(): Settings;
    set(next: Settings): void;
    themes: string[];
    alwaysAvailable: string[];
    /** Old theme names found in saves, and their names now. */
    renamed?: Record<string, string>;
    /** Every secret song. */
    songs?: string[];
  };
  /** Prompt path colors by wing id. */
  wingTints?: Record<string, string>;
  /** The wing on screen changed (undefined on the title screen), e.g. for the soundtrack. */
  onWing?: (wingId: string | undefined) => void;
  /** The shell changed (title <-> play), e.g. to update COLUMNS or tap-to-insert. */
  onShell?: (shell: Shell) => void;
}

/**
 * Decides what the one terminal is showing: the title screen (save slots) or
 * a play session. Autosaves the session after every command. No DOM here.
 */
export class Director {
  controller!: TerminalController;
  shell!: Shell;
  session: GameSession | null = null;
  slot: number | null = null;
  /** Resolves when the current screen has finished drawing its opening. */
  ready: Promise<void> = Promise.resolve();
  private now: () => number;

  constructor(
    private term: TerminalLike,
    private opts: DirectorOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /**
   * Change screens once the current one has completely finished (its command,
   * Quill's lines, and its prompt), so nothing from the old screen lands on
   * the new one. `ready` follows the switch and the new screen's opening.
   */
  private switchTo(fn: () => void) {
    this.ready = new Promise<void>((resolve) =>
      setTimeout(() => {
        fn();
        void this.ready.then(resolve);
      }, 0),
    );
  }

  /** Full terminal reset, sent through the write queue so it lands after earlier output. */
  private clearScreen() {
    this.term.write('\x1bc');
  }

  /** Themes this player may use: the always-available ones plus any earned in any save. */
  private availableThemes(): string[] {
    const s = this.opts.settings;
    if (!s) return [];
    const earned = new Set(s.alwaysAvailable);
    if (this.session) for (const t of this.session.runner.progress.themes) earned.add(t);
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const r = readSlot(this.opts.storage, i);
      if (r.status === 'ok') for (const t of r.data.progress.themes) earned.add(t);
    }
    // Themes saved under an old name count as what they are called now.
    return [...earned].map((t) => s.renamed?.[t] ?? t);
  }

  /** Secret songs found in any save (or the session being played). */
  availableSongs(): string[] {
    const found = new Set<string>(this.session?.runner.progress.songs ?? []);
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const r = readSlot(this.opts.storage, i);
      if (r.status === 'ok') for (const t of r.data.progress.songs ?? []) found.add(t);
    }
    return [...found];
  }

  /** Give a shell the `settings` spell. */
  private addSettings(shell: Shell) {
    const s = this.opts.settings;
    if (!s) return;
    shell.registry.register(
      createSettingsCommand({
        get: s.get,
        set: s.set,
        themes: () =>
          s.themes.map((name) => ({ name, available: this.availableThemes().includes(name) })),
        songs: () =>
          (s.songs ?? []).map((name) => ({
            name,
            available: this.availableSongs().includes(name),
          })),
      }),
    );
  }

  /** Apply changed settings to the current screen (motion, reader mode). */
  configure(change: {
    typeDelay?: number;
    animateSpirits?: boolean;
    artFor?: DirectorOptions['artFor'];
  }) {
    Object.assign(this.opts, change);
    this.controller?.configure(change);
  }

  private tint() {
    const id = this.session?.runner.wing.id;
    this.opts.onWing?.(id);
    if (id && this.opts.wingTints?.[id])
      this.controller.configure({ accent: this.opts.wingTints[id] });
  }

  handleData(data: string): Promise<void> {
    if (this.story.on && this.session) {
      // Escape or Ctrl+C: story mode off, at once, from anywhere.
      if (data === '\x1b' || data === '\x03') {
        this.stopStory(STORY_LINES.off);
        return Promise.resolve();
      }
      // Any key pauses auto play (and is not passed on), cancelling a half-typed command.
      if (this.story.auto || this.story.busy) {
        this.story.auto = false;
        this.story.cancel = true;
        return Promise.resolve();
      }
      // Space at an empty prompt (or in a pager or password prompt) takes the next story step.
      if (data === ' ' && (this.controller.idle || this.controller.awaitingKey))
        return this.storyStep();
    }
    return this.controller.handleData(data);
  }

  /** Story mode (a secret spell, for testing and for reading the story through). */
  private story = {
    on: false,
    auto: false,
    password: undefined as string | undefined,
    busy: false,
    /** Set by a key press: stop typing the current command. */
    cancel: false,
  };

  /** Turn story mode off, with a message once the screen is quiet. */
  private stopStory(message: string) {
    this.story.auto = false;
    this.story.cancel = true;
    this.story.on = false;
    this.session?.setStoryActive(false);
    const say = () => {
      if (this.story.busy) return void setTimeout(say, 50);
      if (this.controller.idle) this.controller.notice(message);
    };
    say();
  }

  /** Type the next story command, as keystrokes, exactly as a player would. */
  async storyStep(): Promise<void> {
    const session = this.session;
    if (!session || this.story.busy) return;
    this.story.busy = true;
    try {
      const c = this.controller;
      if (c.awaitingKey) {
        // A program wants a key: the password it asked for, or q to leave a pager.
        const keys = this.story.password !== undefined ? this.story.password + '\r' : 'q';
        this.story.password = undefined;
        await c.handleData(keys);
        return;
      }
      if (!c.idle) return;
      const next = session.nextStoryCommand();
      if (!next) {
        this.story.auto = false;
        await c.handleData('\x15'); // clear the line, then say so
        session.runner.queue([{ kind: 'narrator', text: STORY_END }]);
        await c.handleData('\r');
        return;
      }
      this.story.cancel = false;
      for (const ch of next.line) {
        if (this.story.cancel) break;
        await c.handleData(ch);
        await sleep(this.opts.typeDelay ? 25 : 0);
      }
      if (this.story.cancel) {
        // Interrupted mid-command: take the half-typed line back, and run nothing.
        this.story.cancel = false;
        session.unshiftStory(next);
        await c.handleData('\x15');
        if (this.story.on) setTimeout(() => this.controller.notice(STORY_LINES.paused), 0);
        return;
      }
      if (next.tab) await c.handleData('\t');
      this.story.password = next.password;
      await c.handleData('\r');
    } finally {
      this.story.busy = false;
    }
  }

  /** Keep stepping until a key is pressed or the story runs out. */
  private async storyAuto(): Promise<void> {
    this.story.auto = true;
    let guard = 0;
    while (this.story.auto && this.story.on && guard++ < 5000) {
      await sleep(this.opts.typeDelay ? 500 : 0);
      if (!this.story.auto) break;
      await this.storyStep();
    }
    // Paused by a key between commands: say so.
    if (this.story.on && this.story.cancel && !this.story.busy) {
      this.story.cancel = false;
      if (this.controller.idle) this.controller.notice(STORY_LINES.paused);
    }
  }

  showTitle(): void {
    this.clearScreen();
    this.session = null;
    this.slot = null;
    this.opts.onWing?.(undefined);
    const vfs = new Vfs({ credentials: { user: 'apprentice', groups: ['apprentice'] } });
    this.shell = new Shell({
      vfs,
      registry: createTitleRegistry(
        // `play` switches screens once its command has finished.
        {
          storage: this.opts.storage,
          play: (n) => this.switchTo(() => this.play(n)),
          now: this.now,
        },
        this.opts.titleHelp,
      ),
      terminal: { stdout: { write() {} }, stderr: { write() {} } },
      shellName: 'lexicon',
    });
    this.addSettings(this.shell);
    this.controller?.dispose();
    const art = this.opts.artFor('title', this.term.cols) ?? '';
    const listing = this.listSlots();
    this.controller = new TerminalController(this.term, this.shell, {
      prompt: TITLE_PROMPT,
      motd: `${art}\n\n${listing}\n${this.opts.titleHelp}\n`,
    });
    this.opts.onShell?.(this.shell);
    this.opts.onChips?.(TITLE_CHIPS);
    this.ready = this.controller.start();
  }

  /** Start or continue a save slot. */
  play(slot: number): void {
    const read = readSlot(this.opts.storage, slot);
    const save = read.status === 'ok' ? read.data : undefined;
    let pendingExit = false;
    const session = createSession({
      content: this.opts.content,
      save,
      now: this.now,
      onExit: () => (pendingExit = true),
      easy: () => this.opts.settings?.get().easy ?? false,
    });
    this.clearScreen();
    this.session = session;
    this.slot = slot;
    this.shell = session.shell;
    // Constructs like | and > are spells too, but the key bar already has those symbols.
    const chips = () =>
      this.opts.onChips?.([
        ...session.runner.known.filter((n) => session.shell.registry.has(n)),
        ...LEXICON_SPELLS,
      ]);
    this.controller?.dispose();
    const controller: TerminalController = new TerminalController(this.term, session.shell, {
      animateSpirits: this.opts.animateSpirits,
      history: session.history,
      artFor: this.opts.artFor,
      typeDelay: this.opts.typeDelay,
      narrator: {
        start: () => session.opening(),
        afterCommand: (line, status, stderr) => session.afterCommand(line, status, stderr),
      },
      onCommand: () => {
        this.save();
        this.tint();
        chips();
        if (pendingExit) this.switchTo(() => this.showTitle());
      },
    });
    this.controller = controller;
    this.addSettings(session.shell);
    session.shell.registry.register(
      createStoryCommand({
        set: (mode) => {
          this.story.on = mode !== 'off';
          session.setStoryActive(this.story.on);
          if (mode === 'auto') setTimeout(() => void this.storyAuto(), 0);
          else this.story.auto = false;
        },
      }),
    );
    this.tint();
    controller.startSpirits();
    this.opts.onShell?.(session.shell);
    this.ready = session.ready
      .then(() => controller.start())
      .then(() => {
        // Save right away so a brand-new slot shows up on the title screen.
        this.save();
        chips();
      });
  }

  /** Write the current session to its slot. Never throws; returns whether it stuck. */
  save(): boolean {
    if (!this.session || this.slot === null) return false;
    return writeSlot(
      this.opts.storage,
      this.slot,
      this.session.toSave(this.controller.history.all()),
    );
  }

  private listSlots(): string {
    const lines = Array.from({ length: SLOT_COUNT }, (_, i) =>
      describeSlot(i + 1, readSlot(this.opts.storage, i + 1), this.now()),
    );
    const note = this.opts.storage
      ? ''
      : '\n  This browser will not keep saves; progress lasts until you close the page.\n';
    return lines.join('\n') + '\n' + note;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

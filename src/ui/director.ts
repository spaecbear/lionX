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
import { Vfs } from '../engine/vfs';
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
  now?: () => number;
  /** The chips the touch layer should show right now. */
  onChips?: (names: string[]) => void;
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

  handleData(data: string): Promise<void> {
    return this.controller.handleData(data);
  }

  showTitle(): void {
    this.clearScreen();
    this.session = null;
    this.slot = null;
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
    });
    this.clearScreen();
    this.session = session;
    this.slot = slot;
    this.shell = session.shell;
    const chips = () => this.opts.onChips?.([...session.runner.known, ...LEXICON_SPELLS]);
    const controller: TerminalController = new TerminalController(this.term, session.shell, {
      history: session.history,
      artFor: this.opts.artFor,
      typeDelay: this.opts.typeDelay,
      narrator: {
        start: () => session.opening(),
        afterCommand: (line, status, stderr) => session.runner.afterCommand(line, status, stderr),
      },
      onCommand: () => {
        this.save();
        chips();
        if (pendingExit) this.switchTo(() => this.showTitle());
      },
    });
    this.controller = controller;
    this.opts.onShell?.(session.shell);
    this.ready = controller.start().then(() => {
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

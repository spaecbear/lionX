/** Command history with up/down navigation that preserves the unsent draft. */
export class History {
  private entries: string[] = [];
  /** Position while browsing; equals entries.length when on the draft. */
  private index = 0;
  private draft = '';

  constructor(
    initial: string[] = [],
    private limit = 500,
  ) {
    this.entries = initial.slice(-limit);
    this.index = this.entries.length;
  }

  /** Record a submitted line. Blank lines and immediate repeats are skipped (like ignoreboth). */
  add(line: string) {
    const trimmed = line.trim();
    if (trimmed && this.entries[this.entries.length - 1] !== line && !line.startsWith(' ')) {
      this.entries.push(line);
      if (this.entries.length > this.limit) this.entries.shift();
    }
    this.index = this.entries.length;
    this.draft = '';
  }

  /** Move to an older entry. Returns the line to show, or null if already at the oldest. */
  up(current: string): string | null {
    if (this.index === 0) return null;
    if (this.index === this.entries.length) this.draft = current;
    return this.entries[--this.index];
  }

  /** Move to a newer entry, ending at the saved draft. Returns null if already on the draft. */
  down(): string | null {
    if (this.index >= this.entries.length) return null;
    this.index++;
    return this.index === this.entries.length ? this.draft : this.entries[this.index];
  }

  resetCursor() {
    this.index = this.entries.length;
    this.draft = '';
  }

  all(): string[] {
    return [...this.entries];
  }
}

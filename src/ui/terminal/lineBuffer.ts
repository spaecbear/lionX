/** Editable input line with a cursor, supporting readline-style editing. */
export class LineBuffer {
  text = '';
  cursor = 0;

  set(text: string, cursor = text.length) {
    this.text = text;
    this.cursor = Math.max(0, Math.min(cursor, text.length));
  }

  insert(s: string) {
    this.text = this.text.slice(0, this.cursor) + s + this.text.slice(this.cursor);
    this.cursor += s.length;
  }

  /** Replace text between `start` and the cursor (used by tab completion). */
  replaceBeforeCursor(start: number, s: string) {
    this.text = this.text.slice(0, start) + s + this.text.slice(this.cursor);
    this.cursor = start + s.length;
  }

  backspace() {
    if (this.cursor === 0) return;
    this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
    this.cursor--;
  }

  deleteForward() {
    this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
  }

  left() {
    if (this.cursor > 0) this.cursor--;
  }

  right() {
    if (this.cursor < this.text.length) this.cursor++;
  }

  home() {
    this.cursor = 0;
  }

  end() {
    this.cursor = this.text.length;
  }

  /** Ctrl+U: delete from start of line to cursor. */
  killToStart() {
    this.text = this.text.slice(this.cursor);
    this.cursor = 0;
  }

  /** Ctrl+K: delete from cursor to end of line. */
  killToEnd() {
    this.text = this.text.slice(0, this.cursor);
  }

  /** Ctrl+W: delete the whitespace-delimited word before the cursor. */
  killWordBack() {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.text[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.text[i - 1])) i--;
    this.text = this.text.slice(0, i) + this.text.slice(this.cursor);
    this.cursor = i;
  }

  /** Alt/Ctrl+Left: move to the start of the previous word (alphanumeric runs). */
  wordLeft() {
    let i = this.cursor;
    while (i > 0 && !/\w/.test(this.text[i - 1])) i--;
    while (i > 0 && /\w/.test(this.text[i - 1])) i--;
    this.cursor = i;
  }

  /** Alt/Ctrl+Right: move to the end of the next word. */
  wordRight() {
    let i = this.cursor;
    const n = this.text.length;
    while (i < n && !/\w/.test(this.text[i])) i++;
    while (i < n && /\w/.test(this.text[i])) i++;
    this.cursor = i;
  }
}

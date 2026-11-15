/**
 * Formatting for Quill's lines: a "Quill:" label, wrapped text with
 * `backticked` spells highlighted, and a typewriter that can be skipped.
 */

export const QUILL_SGR = {
  label: '\x1b[1;97m',
  text: '\x1b[96m',
  code: '\x1b[1;93m',
  art: '\x1b[33m',
  reset: '\x1b[0m',
};

export const QUILL_LABEL = 'Quill: ';

type Style = 'text' | 'code';
export interface StyledChar {
  ch: string;
  style: Style;
}

/** Split on backticks into styled characters (the backticks themselves vanish). */
export function styleSpans(text: string): StyledChar[] {
  const out: StyledChar[] = [];
  let code = false;
  for (const ch of text) {
    if (ch === '`') {
      code = !code;
      continue;
    }
    out.push({ ch, style: code ? 'code' : 'text' });
  }
  return out;
}

/**
 * Word-wrap styled text to `width` columns. The first row leaves room for the
 * label; later rows are indented to line up under the text. Very narrow
 * screens (under 30 columns) skip the hanging indent.
 */
export function wrapQuill(text: string, cols: number): StyledChar[][] {
  const chars = styleSpans(text);
  const indent = cols >= 30 ? QUILL_LABEL.length : 0;
  const rows: StyledChar[][] = [];
  let row: StyledChar[] = [];
  let width = cols - QUILL_LABEL.length;
  let i = 0;
  while (i < chars.length) {
    // Next word (up to and excluding a space).
    let j = i;
    while (j < chars.length && chars[j].ch !== ' ') j++;
    const word = chars.slice(i, j);
    const needed = (row.length ? 1 : 0) + word.length;
    if (row.length && row.length + needed > width) {
      rows.push(row);
      row = [];
      width = cols - indent;
    }
    if (row.length) row.push({ ch: ' ', style: 'text' });
    // Words longer than a whole row are split.
    for (const c of word) {
      if (row.length >= width) {
        rows.push(row);
        row = [];
        width = cols - indent;
      }
      row.push(c);
    }
    i = j + 1;
  }
  rows.push(row);
  return rows;
}

/** Render rows to escape-coded strings, one per character, for the typewriter. */
export function renderQuill(text: string, cols: number): string[] {
  const rows = wrapQuill(text, cols);
  const indent = cols >= 30 ? ' '.repeat(QUILL_LABEL.length) : '';
  const pieces: string[] = [QUILL_SGR.label + QUILL_LABEL.trimEnd() + QUILL_SGR.reset + ' '];
  rows.forEach((row, r) => {
    if (r > 0) pieces.push('\r\n' + indent);
    let style: Style | null = null;
    for (const c of row) {
      let piece = '';
      if (c.style !== style) {
        piece += QUILL_SGR.reset + (c.style === 'code' ? QUILL_SGR.code : QUILL_SGR.text);
        style = c.style;
      }
      pieces.push(piece + c.ch);
    }
  });
  pieces.push(QUILL_SGR.reset + '\r\n');
  return pieces;
}

/** Plain text of a rendered Quill line (for screen readers and tests). */
export function plainQuill(text: string, cols: number): string {
  return (
    renderQuill(text, cols)
      .join('')
      // eslint-disable-next-line no-control-regex -- stripping SGR codes
      .replace(/\x1b\[[0-9;]*m/g, '')
  );
}

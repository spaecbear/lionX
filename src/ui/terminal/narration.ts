/**
 * Formatting for Quill's lines: a "Quill:" label, wrapped text with
 * `backticked` spells highlighted, and a typewriter that can be skipped.
 */

export const QUILL_SGR = {
  label: '\x1b[1;97m',
  text: '\x1b[96m',
  code: '\x1b[1;93m',
  art: '\x1b[33m',
  /** Reward art glows a little brighter than banners. */
  reward: '\x1b[1;93m',
  /** The narrator: grey italics, like stage directions. */
  narrator: '\x1b[3;37m',
  reset: '\x1b[0m',
};

/** Who is talking: Quill (labelled), or the narrator (no label, set in from the edge). */
export type Voice = 'quill' | 'narrator';
const NARRATOR_INDENT = '  ';

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
export function wrapQuill(text: string, cols: number, label = QUILL_LABEL): StyledChar[][] {
  const chars = styleSpans(text);
  const indent = cols >= 30 ? label.length : 0;
  const rows: StyledChar[][] = [];
  let row: StyledChar[] = [];
  let width = cols - label.length;
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
export function renderQuill(text: string, cols: number, voice: Voice = 'quill'): string[] {
  const label = voice === 'quill' ? QUILL_LABEL : NARRATOR_INDENT;
  const textSgr = voice === 'quill' ? QUILL_SGR.text : QUILL_SGR.narrator;
  const rows = wrapQuill(text, cols, label);
  const indent = cols >= 30 ? ' '.repeat(label.length) : '';
  const pieces: string[] = [
    voice === 'quill' ? QUILL_SGR.label + QUILL_LABEL.trimEnd() + QUILL_SGR.reset + ' ' : label,
  ];
  rows.forEach((row, r) => {
    if (r > 0) pieces.push('\r\n' + indent);
    let style: Style | null = null;
    for (const c of row) {
      let piece = '';
      if (c.style !== style) {
        piece += QUILL_SGR.reset + (c.style === 'code' ? QUILL_SGR.code : textSgr);
        style = c.style;
      }
      pieces.push(piece + c.ch);
    }
  });
  pieces.push(QUILL_SGR.reset + '\r\n');
  return pieces;
}

/** Plain text of a rendered Quill line (for screen readers and tests). */
export function plainQuill(text: string, cols: number, voice: Voice = 'quill'): string {
  return (
    renderQuill(text, cols, voice)
      .join('')
      // eslint-disable-next-line no-control-regex -- stripping SGR codes
      .replace(/\x1b\[[0-9;]*m/g, '')
  );
}

/**
 * The `solution` breakdown: the command, then each piece beside what it does.
 * Wide screens put them side by side; narrow ones put the meaning underneath.
 */
export function renderBreakdown(command: string, pieces: [string, string][], cols: number): string {
  const S = QUILL_SGR;
  const out: string[] = [`  ${S.code}${command}${S.reset}`];
  const col = Math.min(24, Math.max(...pieces.map(([p]) => p.length)) + 2);
  const wrap = (text: string, width: number) => {
    const rows: string[] = [];
    let row = '';
    for (const w of text.split(' ')) {
      if (row && row.length + 1 + w.length > width) {
        rows.push(row);
        row = w;
      } else row = row ? `${row} ${w}` : w;
    }
    return [...rows, row];
  };
  const sideBySide = cols >= 60;
  for (const [piece, says] of pieces) {
    if (sideBySide && piece.length < col) {
      const rows = wrap(says, cols - 4 - col);
      out.push(`    ${S.code}${piece.padEnd(col)}${S.reset}${S.text}${rows[0]}${S.reset}`);
      for (const r of rows.slice(1)) out.push(`    ${' '.repeat(col)}${S.text}${r}${S.reset}`);
    } else {
      out.push(`    ${S.code}${piece}${S.reset}`);
      for (const r of wrap(says, cols - 8)) out.push(`        ${S.text}${r}${S.reset}`);
    }
  }
  return out.join('\r\n') + '\r\n\r\n';
}

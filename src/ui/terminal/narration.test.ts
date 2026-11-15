import { plainQuill, renderQuill, styleSpans, wrapQuill } from './narration';

const rowText = (rows: ReturnType<typeof wrapQuill>) =>
  rows.map((r) => r.map((c) => c.ch).join(''));

describe('Quill formatting', () => {
  it('styleSpans marks backticked spells as code and drops the backticks', () => {
    const s = styleSpans('Type `ls -a` now');
    expect(s.map((c) => c.ch).join('')).toBe('Type ls -a now');
    expect(
      s
        .filter((c) => c.style === 'code')
        .map((c) => c.ch)
        .join(''),
    ).toBe('ls -a');
  });

  it('wraps by words, leaving room for the label, with a hanging indent', () => {
    // cols 40: first row 33 wide, later rows 33 wide (indent 7).
    const rows = rowText(
      wrapQuill('Every spell starts with knowing where you stand in the Archive.', 40),
    );
    expect(rows).toEqual(['Every spell starts with knowing', 'where you stand in the Archive.']);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(33);
  });

  it('splits words longer than a row', () => {
    expect(rowText(wrapQuill('a ' + 'x'.repeat(40), 40))).toEqual([
      'a',
      'x'.repeat(33),
      'x'.repeat(7),
    ]);
  });

  it('skips the hanging indent on very narrow screens', () => {
    const plain = plainQuill('one two three four five six', 20);
    expect(plain).toBe('Quill: one two three\r\nfour five six\r\n');
  });

  it('renders label, colors, and code highlighting, one piece per character', () => {
    const pieces = renderQuill('Hi `ls`', 80);
    expect(pieces[0]).toContain('Quill:');
    expect(pieces.join('')).toContain('\x1b[1;93ml');
    expect(plainQuill('Hi `ls`', 80)).toBe('Quill: Hi ls\r\n');
  });
});

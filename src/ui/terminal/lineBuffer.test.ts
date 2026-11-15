import { History } from './history';
import { KEY, splitKeys } from './keys';
import { LineBuffer } from './lineBuffer';

const buf = (text: string, cursor = text.length) => {
  const b = new LineBuffer();
  b.set(text, cursor);
  return b;
};

describe('LineBuffer', () => {
  it('inserts at the cursor and moves it', () => {
    const b = buf('ac', 1);
    b.insert('b');
    expect([b.text, b.cursor]).toEqual(['abc', 2]);
  });

  it('backspace and delete', () => {
    const b = buf('abc', 1);
    b.backspace();
    expect([b.text, b.cursor]).toEqual(['bc', 0]);
    b.backspace();
    expect(b.text).toBe('bc');
    b.deleteForward();
    expect(b.text).toBe('c');
    b.end();
    b.deleteForward();
    expect(b.text).toBe('c');
  });

  it('cursor movement is clamped', () => {
    const b = buf('ab', 0);
    b.left();
    expect(b.cursor).toBe(0);
    b.end();
    b.right();
    expect(b.cursor).toBe(2);
    b.home();
    expect(b.cursor).toBe(0);
    b.set('xyz', 99);
    expect(b.cursor).toBe(3);
  });

  it('kill commands', () => {
    const b = buf('cat notes/page', 4);
    b.killToEnd();
    expect(b.text).toBe('cat ');
    const c = buf('cat notes/page', 4);
    c.killToStart();
    expect([c.text, c.cursor]).toEqual(['notes/page', 0]);
    const d = buf('cat  notes/page  ');
    d.killWordBack();
    expect(d.text).toBe('cat  ');
    d.killWordBack();
    expect(d.text).toBe('');
  });

  it('word movement', () => {
    const b = buf('cat notes/page1', 15);
    b.wordLeft();
    expect(b.cursor).toBe(10);
    b.wordLeft();
    expect(b.cursor).toBe(4);
    b.wordRight();
    expect(b.cursor).toBe(9);
  });

  it('replaceBeforeCursor keeps text after the cursor', () => {
    const b = buf('cat no | less', 6);
    b.replaceBeforeCursor(4, 'notes/');
    expect([b.text, b.cursor]).toEqual(['cat notes/ | less', 10]);
  });
});

describe('History', () => {
  it('navigates up and down and restores the draft', () => {
    const h = new History();
    h.add('ls');
    h.add('pwd');
    expect(h.up('dra')).toBe('pwd');
    expect(h.up('pwd')).toBe('ls');
    expect(h.up('ls')).toBeNull();
    expect(h.down()).toBe('pwd');
    expect(h.down()).toBe('dra');
    expect(h.down()).toBeNull();
  });

  it('skips blanks, repeats, and space-prefixed lines; honors the limit', () => {
    const h = new History(['a', 'b'], 3);
    h.add('b');
    h.add('   ');
    h.add(' secret');
    h.add('c');
    h.add('d');
    expect(h.all()).toEqual(['b', 'c', 'd']);
  });

  it('resetCursor drops navigation state', () => {
    const h = new History(['a']);
    h.up('x');
    h.resetCursor();
    expect(h.up('y')).toBe('a');
    expect(h.down()).toBe('y');
  });
});

describe('splitKeys', () => {
  it('separates characters, CSI and SS3 sequences, and meta keys', () => {
    expect(splitKeys('ab\x1b[A\x1bOH\x1b[3~\x1b[1;5D\x1bb\r')).toEqual([
      'a',
      'b',
      KEY.UP,
      '\x1bOH',
      KEY.DELETE,
      '\x1b[1;5D',
      '\x1bb',
      '\r',
    ]);
  });

  it('keeps emoji together and passes a lone escape through', () => {
    expect(splitKeys('🦁x')).toEqual(['🦁', 'x']);
    expect(splitKeys('\x1b')).toEqual(['\x1b']);
  });
});

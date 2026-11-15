/** Width (CSS px) at which the narrow phone layout switches to the wide layout. */
export const WIDE_BREAKPOINT = 600;
export const MIN_COLUMNS = 40;
export const MAX_FONT_SIZE = 16;
export const MIN_FONT_SIZE = 9;

export type Layout = 'narrow' | 'wide';

export function layoutFor(width: number): Layout {
  return width >= WIDE_BREAKPOINT ? 'wide' : 'narrow';
}

/**
 * Largest whole font size (px) that still fits `MIN_COLUMNS` columns in
 * `width` px, given the font's advance width as a fraction of its size.
 */
export function fontSizeFor(width: number, charWidthRatio: number): number {
  const fit = Math.floor(width / (MIN_COLUMNS * charWidthRatio));
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fit));
}

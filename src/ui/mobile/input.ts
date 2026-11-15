/**
 * Phone keyboards "help" in ways a shell can't use. These helpers undo that
 * and implement the on-screen Ctrl modifier.
 */

const SMART: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '‚': "'", // ‚
  '‛': "'",
  '“': '"', // “
  '”': '"', // ”
  '„': '"', // „
  '′': "'", // ′
  '″': '"', // ″
  '–': '-', // – (iOS turns -- into en/em dashes)
  '—': '--', // —
  '…': '...', // …
  ' ': ' ', // no-break space
};

const SMART_RE = new RegExp(`[${Object.keys(SMART).join('')}]`, 'g');

/** Replace smart punctuation with the plain ASCII the shell expects. */
export function normalizeSmartPunctuation(s: string): string {
  return s.replace(SMART_RE, (c) => SMART[c]);
}

/**
 * Apply a Ctrl modifier to a single key, like a real keyboard: letters and
 * a few symbols become control characters. Returns null if Ctrl has no
 * meaning for that key (the caller sends it unmodified).
 */
export function applyCtrl(key: string): string | null {
  if (key.length !== 1) return null;
  const c = key.toUpperCase();
  const code = c.charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64); // @A-Z[\]^_
  if (key === '?') return '\x7f';
  if (key === ' ') return '\x00';
  return null;
}

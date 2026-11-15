import type { PointerEvent } from 'react';
import { BAR_PAGES, type BarKey } from './keys';

interface Props {
  ctrlArmed: boolean;
  onKey: (key: BarKey) => void;
}

/** Keep focus (and the phone keyboard) on the terminal when a key is pressed. */
const keepFocus = (e: PointerEvent) => e.preventDefault();

/** Symbol keys above the phone keyboard. Swipe sideways for the second page. */
export function KeyBar({ ctrlArmed, onKey }: Props) {
  return (
    <div className="keybar" role="toolbar" aria-label="Symbol keys">
      {BAR_PAGES.map((page, i) => (
        <div className="keybar-page" key={i}>
          {page.map((k) => (
            <button
              key={k.label}
              type="button"
              className={`key${k.wide ? ' key-wide' : ''}${k.send === 'ctrl' && ctrlArmed ? ' key-armed' : ''}`}
              aria-label={k.aria}
              aria-pressed={k.send === 'ctrl' ? ctrlArmed : undefined}
              onPointerDown={keepFocus}
              onClick={() => onKey(k)}
            >
              {k.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

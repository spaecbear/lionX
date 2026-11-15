import type { PointerEvent } from 'react';

interface Props {
  commands: string[];
  onChip: (name: string) => void;
}

const keepFocus = (e: PointerEvent) => e.preventDefault();

/** Learned spells as one-tap chips. They insert only the name, never arguments. */
export function Chips({ commands, onChip }: Props) {
  if (commands.length === 0) return null;
  return (
    <div className="chips" role="toolbar" aria-label="Known spells">
      {commands.map((name) => (
        <button
          key={name}
          type="button"
          className="chip"
          onPointerDown={keepFocus}
          onClick={() => onChip(name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

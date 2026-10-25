import { useEffect, useRef, useState } from 'react';
import { strings } from '../strings.ts';

export type PaletteAction = { id: string; label: string; hint?: string; run: () => void };

/** Ctrl+K. Opened from the keyboard hundreds of times a day, so it has no animation. */
export function CommandPalette({ actions, onClose }: { actions: PaletteAction[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = actions.filter((a) => a.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12);
  useEffect(() => input.current?.focus(), []);

  const run = (a?: PaletteAction) => {
    if (!a) return;
    onClose();
    a.run();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[active]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-ink/30 px-4 pt-[12dvh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={strings.palette.title} onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-[560px] rounded-card border border-line bg-card p-2 shadow-lg">
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={shown.length ? `palette-${active}` : undefined}
          aria-label={strings.palette.title}
          placeholder={strings.palette.placeholder}
          className="w-full bg-transparent px-2 py-2 text-base placeholder:text-muted focus:outline-none"
        />
        <ul id="palette-list" role="listbox" className="max-h-[50dvh] overflow-auto border-t border-line pt-1">
          {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">{strings.composer.noMatch}</li>}
          {shown.map((a, i) => (
            <li key={a.id} id={`palette-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => run(a)} className={`flex cursor-pointer items-baseline gap-2 rounded-control px-2 py-1.5 text-sm ${i === active ? 'bg-well' : ''}`}>
              <span>{a.label}</span>
              {a.hint && <span className="ml-auto text-muted">{a.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

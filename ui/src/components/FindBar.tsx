import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { strings } from '../strings.ts';
import { IconButton } from './Button.tsx';

type Props = { query: string; count: number; at: number; onQuery: (q: string) => void; onStep: (dir: 1 | -1) => void; onClose: () => void };

/** Ctrl+F over the transcript. Enter goes to the next card with a match, Shift+Enter to the previous one. */
export function FindBar({ query, count, at, onQuery, onStep, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <div role="search" className="flex items-center gap-1 border-b border-line bg-paper px-4 py-1.5">
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label={strings.find.label}
        placeholder={strings.find.label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          else if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
        }}
        className="min-w-0 flex-1 rounded-control border border-line bg-card px-2 py-1 text-sm focus:border-accent focus:outline-none"
      />
      <span role="status" className="w-20 text-right text-sm text-muted">{query.trim() ? (count ? strings.find.of(at + 1, count) : strings.find.none) : ''}</span>
      <IconButton label={strings.find.previous} onClick={() => onStep(-1)} disabled={!count}><ChevronUp aria-hidden className="size-4" /></IconButton>
      <IconButton label={strings.find.next} onClick={() => onStep(1)} disabled={!count}><ChevronDown aria-hidden className="size-4" /></IconButton>
      <IconButton label={strings.find.close} onClick={onClose}><X aria-hidden className="size-4" /></IconButton>
    </div>
  );
}

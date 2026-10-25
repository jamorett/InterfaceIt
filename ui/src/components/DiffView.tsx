import type { DiffLine } from '../model.ts';

/** Changed lines of a file: removed in red, added in teal, a gutter with line numbers, long unchanged stretches folded. Colour is never the only signal: every line has a +/− sign. */
export function DiffView({ lines, label, className = '' }: { lines: DiffLine[]; label: string; className?: string }) {
  return (
    <pre tabIndex={0} aria-label={label} className={`overflow-auto rounded-control bg-well py-1 font-mono text-sm leading-snug text-ink ${className}`}>
      {lines.map((l, i) =>
        l.fold ? (
          <span key={i} className="block px-2 text-xs text-muted italic">{l.text}</span>
        ) : (
          <span key={i} className={`flex whitespace-pre ${l.kind === 'add' ? 'bg-accent/15' : l.kind === 'del' ? 'bg-danger/15' : ''}`}>
            <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-muted select-none">{l.newNo ?? l.oldNo ?? ''}</span>
            <span aria-hidden className="w-4 shrink-0 select-none">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
            <span>{l.kind === 'add' ? <span className="sr-only">added: </span> : l.kind === 'del' ? <span className="sr-only">removed: </span> : null}{l.text || ' '}</span>
          </span>
        ),
      )}
    </pre>
  );
}

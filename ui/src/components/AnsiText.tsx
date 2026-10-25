import { useMemo } from 'react';
import { ansiSpans, MAX_SHOWN_CHARS } from '../state/ansi.ts';

// Terminal colours become design tokens (PLAN.md §6.2), never the terminal's own hex values, so they pass contrast in both themes.
const colour: Record<string, string> = {
  black: 'text-muted', white: 'text-ink', red: 'text-danger', green: 'text-accent', yellow: 'text-caution', blue: 'text-accent', magenta: 'text-danger', cyan: 'text-accent',
};

export function AnsiText({ text, limit = MAX_SHOWN_CHARS }: { text: string; limit?: number }) {
  const spans = useMemo(() => ansiSpans(text.length > limit ? text.slice(0, limit) : text), [text, limit]);
  return (
    <>
      {spans.map((s, i) => {
        const cls = [s.fg ? colour[s.fg.replace(/^bright-/, '')] : '', s.bold ? 'font-semibold' : '', s.italic ? 'italic' : '', s.underline ? 'underline' : ''].filter(Boolean).join(' ');
        return cls ? <span key={i} className={cls}>{s.text}</span> : s.text;
      })}
    </>
  );
}

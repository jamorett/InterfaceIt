import { Folder } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { strings } from '../strings.ts';
import { middleTruncate } from '../text.ts';

/**
 * Recent projects come from the SDK's session list. A folder the app has not seen before needs the trust question first:
 * the CLI skips its own trust dialog in SDK mode, so the app must ask (PLAN.md §3.5).
 */
export function ProjectPicker({ recent, trusting, onOpen }: { recent: string[]; trusting?: string; onOpen?: (path: string, trusted: boolean) => void }) {
  const [path, setPath] = useState('');
  const [asking, setAsking] = useState<string | undefined>(trusting);

  if (asking) {
    return (
      <div className="grid h-full place-items-center overflow-auto bg-paper p-4 text-ink">
        <section aria-labelledby="trust-title" className="enter-slow w-full max-w-[480px] rounded-card border border-line bg-card p-5">
          <h1 id="trust-title" className="text-lg font-semibold">{strings.picker.trustTitle}</h1>
          <p className="mt-1 font-mono text-base [overflow-wrap:anywhere]">{asking}</p>
          <p className="mt-2 text-base text-muted">{strings.picker.trustBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onOpen?.(asking, true)}>{strings.picker.trust}</Button>
            <Button onClick={() => setAsking(undefined)}>{strings.picker.back}</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-start justify-items-center overflow-auto bg-paper p-4 text-ink">
      <section aria-labelledby="pick-title" className="enter-slow w-full max-w-[560px] rounded-card border border-line bg-card p-5">
        <h1 id="pick-title" className="text-lg font-semibold">{strings.picker.title}</h1>
        <h2 className="mt-4 text-sm font-semibold text-muted">{strings.picker.recent}</h2>
        <ul className="mt-1 grid gap-1">
          {recent.map((p) => (
            <li key={p}>
              <button type="button" onClick={() => onOpen?.(p, true)} title={p} className="press hoverable flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-base pointer-coarse:min-h-11">
                <Folder aria-hidden className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 truncate font-mono">{middleTruncate(p, 60)}</span>
              </button>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (path.trim()) setAsking(path.trim()); }}>
          <label htmlFor="folder" className="w-full text-sm font-semibold text-muted">{strings.picker.browse}</label>
          <input id="folder" value={path} onChange={(e) => setPath(e.target.value)} placeholder={strings.picker.path} className="min-h-9 min-w-0 flex-1 rounded-control border border-line bg-paper px-2 font-mono text-base placeholder:text-muted pointer-coarse:min-h-11" />
          <Button type="submit" variant="primary" disabled={!path.trim()}>{strings.picker.open}</Button>
        </form>
      </section>
    </div>
  );
}

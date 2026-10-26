import { Folder } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { strings } from '../strings.ts';
import { middleTruncate } from '../text.ts';

/**
 * Recent projects come from the SDK's session list. A folder the app has not seen before needs the trust question first:
 * the CLI skips its own trust dialog in SDK mode, so the app must ask (PLAN.md §3.5).
 */
export function ProjectPicker({ recent, running = [], trusting, notice, busy, onOpen, onAttach, onTrust, onBack }: { recent: string[]; /** sessions the bridge is already running that this tab could take over */ running?: { id: string; title: string; cwd: string }[]; onAttach?: (id: string) => void; /** a folder waiting for the trust question */ trusting?: string; notice?: string; busy?: boolean; onOpen?: (path: string) => void; onTrust?: () => void; onBack?: () => void }) {
  const [path, setPath] = useState('');

  if (trusting) {
    return (
      <div className="grid h-full grid-cols-[minmax(0,1fr)] place-items-center overflow-auto bg-paper p-4 text-ink">
        <section aria-labelledby="trust-title" className="enter-slow w-full max-w-[480px] rounded-card border border-line bg-card p-5">
          <h1 id="trust-title" className="text-lg font-semibold">{strings.picker.trustTitle}</h1>
          <p className="mt-1 font-mono text-base [overflow-wrap:anywhere]">{trusting}</p>
          <p className="mt-2 text-base text-muted">{strings.picker.trustBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onTrust}>{strings.picker.trust}</Button>
            <Button onClick={onBack}>{strings.picker.back}</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] place-items-center overflow-auto bg-paper p-4 text-ink">
      <section aria-labelledby="pick-title" className="enter-slow w-full max-w-[560px] rounded-card border border-line bg-card p-6 shadow-[0_1px_2px_color-mix(in_srgb,var(--text)_8%,transparent)]">
        <h1 id="pick-title" className="text-lg font-semibold">{strings.picker.title}</h1>
        {running.length > 0 && (
          <>
            <h2 className="mt-4 text-sm font-semibold text-muted">{strings.picker.running}</h2>
            <ul className="mt-1 grid gap-1">
              {running.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onAttach?.(r.id)} title={r.cwd} className="press hoverable flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-base pointer-coarse:min-h-11">
                    <span aria-hidden className="breathe size-2 shrink-0 rounded-full bg-accent-fill" />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted">{middleTruncate(r.cwd, 28)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <h2 className="mt-4 text-sm font-semibold text-muted">{strings.picker.recent}</h2>
        <ul className="mt-1 grid gap-1">
          {recent.map((p) => (
            <li key={p}>
              <button type="button" onClick={() => onOpen?.(p)} disabled={busy} title={p} className="press hoverable flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-base pointer-coarse:min-h-11">
                <Folder aria-hidden className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 truncate font-mono">{middleTruncate(p, 60)}</span>
              </button>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (path.trim()) onOpen?.(path.trim()); }}>
          <label htmlFor="folder" className="w-full text-sm font-semibold text-muted">{strings.picker.browse}</label>
          <input id="folder" value={path} onChange={(e) => setPath(e.target.value)} placeholder={strings.picker.path} className="min-h-9 min-w-0 flex-1 rounded-control border border-line bg-paper px-2 font-mono text-base placeholder:text-muted pointer-coarse:min-h-11" />
          <Button type="submit" variant="primary" disabled={!path.trim() || busy}>{strings.picker.open}</Button>
          {notice && <p role="alert" className="w-full text-sm text-danger [overflow-wrap:anywhere]">{notice}</p>}
        </form>
      </section>
    </div>
  );
}

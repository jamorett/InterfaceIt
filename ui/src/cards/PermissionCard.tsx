import { Check, Diamond, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '../components/Button.tsx';
import type { PermissionDecision, PermissionView } from '../model.ts';
import { strings } from '../strings.ts';

type ScopeDecision = Exclude<PermissionDecision, 'allowed-once' | 'denied' | 'cancelled'>;
const scopes: ScopeDecision[] = ['allowed-session', 'allowed-local', 'allowed-project', 'allowed-user'];

export function PermissionCard({ view, onDecide }: { view: PermissionView; onDecide?: (d: PermissionDecision, reason?: string) => void }) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState('');
  const decided = view.decision;
  const canRemember = !view.requiresUserInteraction && view.canRemember !== false;

  const decide = (d: PermissionDecision, r?: string) => {
    setScopeOpen(false);
    setDenyOpen(false);
    onDecide?.(d, r);
  };

  // Y / N / A work while the card has focus and never while typing a reason (PLAN.md §9.2).
  // Keyboard decisions change the card instantly: no animation on repeated, keyboard-driven actions.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (decided || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'y') decide('allowed-once');
    else if (k === 'n') decide('denied');
    else if (k === 'a' && canRemember) setScopeOpen((o) => !o);
  };

  if (decided) {
    const ok = decided.startsWith('allowed');
    return (
      <div role="group" aria-label={view.title} className="flex flex-wrap items-center gap-x-2 rounded-card border border-line bg-card px-3 py-2 text-base">
        {ok ? <Check aria-hidden className="size-4 shrink-0 text-accent" /> : <X aria-hidden className="size-4 shrink-0 text-danger" />}
        <span className="font-medium">{strings.permission.decided[decided]}</span>
        <span className="min-w-0 truncate text-muted [overflow-wrap:anywhere]">{view.title}</span>
        {view.denyReason && <span className="w-full text-sm text-muted">“{view.denyReason}”</span>}
      </div>
    );
  }

  return (
    <section
      role="alert"
      aria-label={`${strings.permission.needsOk}: ${view.title}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-instant={view.instant ? '' : undefined}
      className="enter glow-once @container rounded-card border-l-4 border-caution bg-attention p-3 text-on-attention"
    >
      <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
        <Diamond aria-hidden className="size-3.5 fill-current" />
        {strings.permission.needsOk}
        {view.agent && <span className="rounded-full border border-on-attention/45 px-2 font-normal">{strings.permission.by(view.agent)}</span>}
      </div>
      <p className="mt-1 text-md font-semibold [overflow-wrap:anywhere]">{view.title}</p>
      {view.description && <p className="text-base [overflow-wrap:anywhere]">{view.description}</p>}

      {view.diff && (
        <pre tabIndex={0} aria-label="Change preview" className="mt-2 max-h-48 overflow-auto rounded-control bg-card p-2 font-mono text-sm leading-snug text-ink">
          {view.diff.map((l, i) => (
            <span key={i} className={`block whitespace-pre ${l.kind === 'add' ? 'bg-accent/15' : l.kind === 'del' ? 'bg-danger/15' : ''}`}>
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
              {l.text}
            </span>
          ))}
        </pre>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => decide('allowed-once')}>{strings.permission.allow}</Button>
        {canRemember && (
          <Button variant="attention" aria-expanded={scopeOpen} onClick={() => { setScopeOpen((o) => !o); setDenyOpen(false); }}>
            {strings.permission.allowFor}
          </Button>
        )}
        <Button variant="attention" aria-expanded={denyOpen} onClick={() => { setDenyOpen((o) => !o); setScopeOpen(false); }}>
          {strings.permission.deny}
        </Button>
      </div>

      {scopeOpen && (
        <ul className="mt-2 grid gap-1 @md:grid-cols-2" aria-label={strings.permission.allowFor}>
          {scopes.map((s) => (
            <li key={s}>
              <Button variant="attention" className="w-full justify-start" onClick={() => decide(s)}>{strings.permission.scopes[s as keyof typeof strings.permission.scopes]}</Button>
            </li>
          ))}
        </ul>
      )}

      {denyOpen && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); decide('denied', reason.trim() || undefined); }}>
          <label className="w-full text-sm" htmlFor={`deny-${view.id}`}>{strings.permission.reasonLabel}</label>
          <input id={`deny-${view.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-8 min-w-0 flex-1 rounded-control border border-on-attention/45 bg-card px-2 text-ink pointer-coarse:min-h-11" />
          <Button type="submit" variant="attention">{strings.permission.denyNow}</Button>
        </form>
      )}

      <p className="mt-2 text-sm opacity-90">{view.requiresUserInteraction ? strings.permission.requiresPerson : canRemember ? strings.permission.keys : strings.permission.keysOnce}</p>
    </section>
  );
}

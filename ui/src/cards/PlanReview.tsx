import { Check, Diamond, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import type { PlanView } from '../model.ts';
import { strings } from '../strings.ts';

type Decision = NonNullable<PlanView['decision']>;

export function PlanReview({ view, onDecide }: { view: PlanView; onDecide?: (d: Decision, feedback?: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (view.decision) {
    const ok = view.decision !== 'rejected';
    return (
      <div role="group" aria-label={strings.plan.region} className="flex items-center gap-2 rounded-card border border-line bg-card px-3 py-2 text-base">
        {ok ? <Check aria-hidden className="size-4 shrink-0 text-accent" /> : <X aria-hidden className="size-4 shrink-0 text-danger" />}
        {strings.plan.decided[view.decision]}
      </div>
    );
  }

  return (
    <section role="alert" aria-label={strings.plan.header} data-instant={view.instant ? '' : undefined} className="enter glow-once @container rounded-card border-l-4 border-caution bg-attention p-3 text-on-attention">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Diamond aria-hidden className="size-3.5 fill-current" />
        {strings.plan.header}
      </div>
      <div tabIndex={0} role="region" aria-label={strings.plan.region} className="mt-2 max-h-64 overflow-auto rounded-control bg-card p-3 text-base whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        {view.text}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onDecide?.('approved-auto')}>{strings.plan.approveAuto}</Button>
        <Button variant="attention" onClick={() => onDecide?.('approved-manual')}>{strings.plan.approveManual}</Button>
        <Button variant="attention" aria-expanded={rejecting} onClick={() => setRejecting((r) => !r)}>{strings.plan.reject}</Button>
      </div>
      {rejecting && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); onDecide?.('rejected', feedback.trim() || undefined); }}>
          <label className="w-full text-sm" htmlFor={`plan-fb-${view.id}`}>{strings.plan.feedback}</label>
          <input id={`plan-fb-${view.id}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="min-h-8 min-w-0 flex-1 rounded-control border border-on-attention/45 bg-card px-2 text-ink pointer-coarse:min-h-11" />
          <Button type="submit" variant="attention">{strings.plan.sendFeedback}</Button>
        </form>
      )}
    </section>
  );
}

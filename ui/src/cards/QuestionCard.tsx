import { Check, Diamond } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import type { QuestionView } from '../model.ts';
import { strings } from '../strings.ts';

export function QuestionCard({ view, onAnswer }: { view: QuestionView; onAnswer?: (answers: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const type = view.multiSelect ? 'checkbox' : 'radio';

  if (view.answer) {
    return (
      <div role="group" aria-label={view.header} className="flex items-center gap-2 rounded-card border border-line bg-card px-3 py-2 text-base">
        <Check aria-hidden className="size-4 shrink-0 text-accent" />
        <span className="[overflow-wrap:anywhere]">{strings.question.answered(view.answer.join(', '))}</span>
      </div>
    );
  }

  const toggle = (label: string) =>
    setPicked((p) => (view.multiSelect ? (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]) : [label]));
  const answers = [...picked, ...(other.trim() ? [other.trim()] : [])];

  return (
    <form
      role="alert"
      aria-label={`${strings.question.header}: ${view.question}`}
      data-instant={view.instant ? '' : undefined}
      onSubmit={(e) => { e.preventDefault(); if (answers.length) onAnswer?.(answers); }}
      className="enter glow-once @container rounded-card border-l-4 border-caution bg-attention p-3 text-on-attention"
    >
      <fieldset className="min-w-0">
        <legend className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          <Diamond aria-hidden className="size-3.5 fill-current" />
          {strings.question.header}
          <span className="rounded-full border border-on-attention/45 px-2 font-normal">{view.header}</span>
        </legend>
        <p className="mt-1 text-md font-semibold [overflow-wrap:anywhere]">{view.question}</p>
        <p className="text-sm">{view.multiSelect ? strings.question.chooseMany : strings.question.chooseOne}</p>
        <div className="mt-2 grid gap-2 @md:grid-cols-2">
          {view.options.map((o) => (
            <label key={o.label} className="press flex cursor-pointer items-start gap-2 rounded-control border border-on-attention/45 bg-card p-2 text-ink has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent">
              <input type={type} name={view.id} checked={picked.includes(o.label)} onChange={() => toggle(o.label)} className="mt-1 size-4 accent-accent-fill" />
              <span className="min-w-0">
                <span className="block font-medium">{o.label}</span>
                <span className="block text-sm text-muted [overflow-wrap:anywhere]">{o.description}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-2 block text-sm" htmlFor={`other-${view.id}`}>{strings.question.other}</label>
        <input id={`other-${view.id}`} value={other} onChange={(e) => setOther(e.target.value)} placeholder={strings.question.otherPlaceholder} className="min-h-8 w-full rounded-control border border-on-attention/45 bg-card px-2 text-ink placeholder:text-muted pointer-coarse:min-h-11" />
      </fieldset>
      <Button type="submit" variant="primary" className="mt-3" disabled={!answers.length}>{strings.question.submit}</Button>
    </form>
  );
}

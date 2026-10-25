import type { TodoItem } from '../model.ts';
import { strings } from '../strings.ts';

const seg = {
  completed: 'bg-accent-fill',
  in_progress: 'bg-attention ring-1 ring-caution',
  pending: 'ring-1 ring-line',
} as const;

/** "3 / 7 · Running tests": the only real progress bar, driven by the model's own task list (it never reports a percentage). */
export function TodoStrip({ items }: { items: TodoItem[] }) {
  if (!items.length) return null; // no list, no strip
  const done = items.filter((i) => i.status === 'completed').length;
  const now = items.find((i) => i.status === 'in_progress')?.activeForm;
  return (
    <div role="group" aria-label={strings.todo.region} className="border-t border-line px-4 pt-2 pb-1">
      <div aria-hidden className="flex gap-1">
        {items.map((it, i) => (
          <span key={i} className={`h-1.5 min-w-1 flex-1 rounded-full transition-colors duration-[var(--dur-base)] ${seg[it.status]}`} />
        ))}
      </div>
      <p className="mt-1 truncate text-sm text-muted">{strings.todo.summary(done, items.length, now)}</p>
    </div>
  );
}

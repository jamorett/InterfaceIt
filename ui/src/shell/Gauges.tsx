import type { ContextView, LimitWindow } from '../model.ts';
import { strings } from '../strings.ts';
import { formatTokens, percent } from '../text.ts';

const R = 7;
const C = 2 * Math.PI * R;

/** Ring in the status bar: teal, then caution at 80%, danger at 95% (PLAN.md §7.4). The ring eases to its new value when `usage` arrives. */
export function ContextGauge({ context }: { context: ContextView }) {
  const p = Math.min(context.totalTokens / context.maxTokens, 1);
  const tone = p >= 0.95 ? 'text-danger' : p >= 0.8 ? 'text-caution' : 'text-accent';
  const label = strings.context.detail(formatTokens(context.totalTokens), formatTokens(context.maxTokens), Math.round(p * 100));
  return (
    <span
      role="meter"
      aria-label={strings.context.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-valuetext={label}
      title={p >= 0.8 ? `${label}. ${strings.context.compactHint}` : label}
      className={`inline-flex items-center gap-1.5 text-sm ${tone}`}
    >
      <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" className="stroke-line" />
        <circle
          cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round" stroke="currentColor"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
          className="transition-[stroke-dashoffset] duration-[var(--dur-slow)] ease-[var(--ease-out)]"
        />
      </svg>
      <span className="text-ink">{strings.context.label} {percent(p)}</span>
    </span>
  );
}

/** One small bar per usage window (5 hours, 7 days). Subscription users see limits instead of dollars. */
export function UsageMeter({ windows }: { windows: LimitWindow[] }) {
  return (
    <ul aria-label={strings.limits.label} className="flex items-center gap-3 text-sm">
      {windows.map((w) => {
        const hot = w.utilization >= 0.75;
        return (
          <li key={w.label} className="flex items-center gap-1.5" title={`${w.label}: ${percent(w.utilization)}, ${strings.limits.resets(w.resetsAt)}`}>
            <span className="text-muted">{w.label}</span>
            <span aria-hidden className="h-1.5 w-10 overflow-hidden rounded-full bg-well ring-1 ring-line">
              <span className={`block h-full origin-left ${hot ? 'bg-caution' : 'bg-accent-fill'}`} style={{ width: percent(w.utilization) }} />
            </span>
            <span className={hot ? 'font-medium text-caution' : 'text-ink'}>{percent(w.utilization)}</span>
          </li>
        );
      })}
    </ul>
  );
}

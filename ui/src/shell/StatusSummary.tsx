import { SessionBadge } from '../components/SessionBadge.tsx';
import type { ContextView, LimitWindow, SessionState } from '../model.ts';
import { strings } from '../strings.ts';
import { ContextGauge, UsageMeter } from './Gauges.tsx';

export type StatusProps = {
  state: SessionState;
  context?: ContextView;
  limits?: LimitWindow[];
  background?: number;
  /** output of the user's own statusLine command, already stripped of escape codes */
  statusline?: string;
};

/** The status bar's content. On narrow windows it moves into the header's overflow menu instead (PLAN.md §7.3). */
export function StatusSummary({ state, context, limits, background, statusline }: StatusProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      <SessionBadge state={state} />
      {context && <ContextGauge context={context} />}
      {limits && limits.length > 0 && <UsageMeter windows={limits} />}
      {background ? <span className="text-muted">{strings.status.background(background)}</span> : null}
      {statusline && <span className="min-w-0 truncate font-mono text-muted">{statusline}</span>}
    </div>
  );
}

import { Minimize2, Square } from 'lucide-react';
import { PermissionCard } from '../cards/PermissionCard.tsx';
import { PlanReview } from '../cards/PlanReview.tsx';
import { QuestionCard } from '../cards/QuestionCard.tsx';
import { ToolCard } from '../cards/ToolCard.tsx';
import type { PermissionDecision, PlanView, TranscriptItem } from '../model.ts';
import { strings } from '../strings.ts';
import { formatTokens } from '../text.ts';
import { CardBoundary, CrashCard } from './CardBoundary.tsx';

function keyOf(item: TranscriptItem): string {
  if (item.kind === 'tool') return `tool-${item.tool.id}`;
  if ('view' in item) return `${item.kind}-${item.view.id}`;
  return `${item.kind}-${item.id}`;
}

export type Handlers = {
  onPermission?: (id: string, decision: PermissionDecision, reason?: string) => void;
  onAnswer?: (id: string, answers: string[]) => void;
  onPlan?: (id: string, decision: NonNullable<PlanView['decision']>, feedback?: string) => void;
};

function Item({ item, debug, on }: { item: TranscriptItem; debug: boolean; on: Handlers }) {
  switch (item.kind) {
    case 'user':
      return (
        <p dir="auto" data-instant={item.instant ? '' : undefined} className="enter ml-auto max-w-[85%] rounded-card bg-accent-fill px-3 py-2 text-base whitespace-pre-wrap text-on-accent [overflow-wrap:anywhere]">
          {item.text}
        </p>
      );
    case 'assistant':
      return item.synthetic ? (
        <div data-instant={item.instant ? '' : undefined} className="enter rounded-card border border-line bg-well p-3">
          <p className="text-sm text-muted">{strings.transcript.local}</p>
          <pre tabIndex={0} className="mt-1 max-h-72 overflow-auto font-mono text-sm leading-snug whitespace-pre-wrap">{item.text}</pre>
        </div>
      ) : (
        <p dir="auto" data-instant={item.instant ? '' : undefined} className={`enter text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${item.streaming ? 'caret' : ''}`}>
          {item.text}
        </p>
      );
    case 'thinking':
      return (
        <p className={`text-sm text-muted ${item.live ? 'thinking' : ''}`}>
          {item.live ? strings.thinking.live(item.tokens) : strings.thinking.done(item.seconds ?? 0)}
        </p>
      );
    case 'tool':
      return <ToolCard tool={item.tool} />;
    case 'permission':
      return <PermissionCard view={item.view} onDecide={(d, r) => on.onPermission?.(item.view.id, d, r)} />;
    case 'question':
      return <QuestionCard view={item.view} onAnswer={(a) => on.onAnswer?.(item.view.id, a)} />;
    case 'plan':
      return <PlanReview view={item.view} onDecide={(d, f) => on.onPlan?.(item.view.id, d, f)} />;
    case 'compact':
      return (
        <div role="separator" className="flex items-center gap-3 text-sm text-muted">
          <span aria-hidden className="h-px flex-1 bg-line" />
          <Minimize2 aria-hidden className="size-3.5" />
          {strings.context.compacted(formatTokens(item.before), formatTokens(item.after))}
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      );
    case 'notice':
      return (
        <p className={`rounded-control border px-3 py-1.5 text-sm ${item.level === 'danger' ? 'border-danger' : item.level === 'warning' ? 'border-caution' : 'border-line'}`}>{item.text}</p>
      );
    case 'stopped':
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Square aria-hidden className="size-3.5" /> {strings.transcript.stopped}
        </p>
      );
    case 'unknown':
      return debug ? (
        <details className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-muted">
          <summary className="cursor-pointer">{strings.transcript.unknown}</summary>
          <pre tabIndex={0} className="mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(item.raw, null, 2)}</pre>
        </details>
      ) : null;
    case 'crash':
      return <CrashCard raw={item.raw} />;
  }
}

/** The conversation column: 780 px max, centred. Cards are wrapped one by one so a renderer bug stays local. */
export function Transcript({ items, debug = false, announce, on = {} }: { items: TranscriptItem[]; debug?: boolean; announce?: string; on?: Handlers }) {
  return (
    <div role="log" aria-label={strings.transcript.region} aria-live="off" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[780px] flex-col gap-3 px-4 py-4">
        {items.map((item) => (
          <CardBoundary key={keyOf(item)} raw={item}>
            <Item item={item} debug={debug} on={on} />
          </CardBoundary>
        ))}
      </div>
      {/* once per finished block, never per token (PLAN.md §9.3) */}
      <div className="sr-only" aria-live="polite">{announce}</div>
    </div>
  );
}

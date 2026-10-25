import { ArrowDown, Minimize2, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { PermissionCard } from '../cards/PermissionCard.tsx';
import { PlanReview } from '../cards/PlanReview.tsx';
import { QuestionCard } from '../cards/QuestionCard.tsx';
import { ToolCard } from '../cards/ToolCard.tsx';
import type { PermissionDecision, PlanView, TranscriptItem } from '../model.ts';
import { imageSrc } from '../state/describe.ts';
import { strings } from '../strings.ts';
import { formatTokens } from '../text.ts';
import { CardBoundary, CrashCard } from './CardBoundary.tsx';
import { Markdown } from './Markdown.tsx';

function keyOf(item: TranscriptItem): string {
  if (item.kind === 'tool') return `tool-${item.tool.id}`;
  if ('view' in item) return `${item.kind}-${item.view.id}`;
  return `${item.kind}-${item.id}`;
}

export type Handlers = {
  onPermission?: (id: string, decision: PermissionDecision, reason?: string, edited?: Record<string, string>) => void;
  onAnswer?: (id: string, answers: string[]) => void;
  onFull?: (toolId: string) => void;
  onPlan?: (id: string, decision: NonNullable<PlanView['decision']>, feedback?: string) => void;
};

function Item({ item, debug, on }: { item: TranscriptItem; debug: boolean; on: Handlers }) {
  switch (item.kind) {
    case 'user':
      return (
        <p dir="auto" data-instant={item.instant ? '' : undefined} className="enter ml-auto max-w-[85%] rounded-card bg-accent-fill px-3 py-2 text-base whitespace-pre-wrap text-on-accent [overflow-wrap:anywhere]">
          {item.images?.map((im, i) => { const src = imageSrc(im); return src && <img key={i} src={src} alt={strings.composer.attached(i + 1)} className="mb-2 max-h-48 rounded-control" />; })}
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
        <div data-instant={item.instant ? '' : undefined} className="enter text-base leading-relaxed [overflow-wrap:anywhere]">
          <Markdown text={item.text} streaming={item.streaming} />
        </div>
      );
    case 'thinking':
      return (
        <p className={`text-sm text-muted ${item.live ? 'thinking' : ''}`}>
          {item.live ? strings.thinking.live(item.tokens) : strings.thinking.done(item.seconds ?? 0)}
        </p>
      );
    case 'tool':
      return <ToolCard tool={item.tool} onFull={on.onFull} />;
    case 'permission':
      return <PermissionCard view={item.view} onDecide={(d, r, ed) => on.onPermission?.(item.view.id, d, r, ed)} />;
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

/** positions of the cards that still wait for an answer */
export function waitingIndexes(items: TranscriptItem[]): number[] {
  return items.flatMap((it, i) =>
    (it.kind === 'permission' && !it.view.decision) || (it.kind === 'question' && !it.view.answer) || (it.kind === 'plan' && !it.view.decision) ? [i] : []);
}

function Card({ item, debug, on }: { item: TranscriptItem; debug: boolean; on: Handlers }) {
  return (
    <CardBoundary raw={item}>
      <Item item={item} debug={debug} on={on} />
    </CardBoundary>
  );
}

type Props = {
  items: TranscriptItem[];
  debug?: boolean;
  announce?: string;
  on?: Handlers;
  /** false renders every card (the static design previews, so tests can see all of them); the app always virtualizes */
  virtualize?: boolean;
};

/**
 * The conversation column: 780 px max, centred. Long sessions are virtualized (only the cards on screen exist);
 * it follows the end while you are at the bottom and, once you scroll up, leaves you alone and offers "jump to latest".
 * Cards are wrapped one by one so a renderer bug stays local.
 */
export function Transcript({ items, debug = false, announce, on = {}, virtualize = true }: Props) {
  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const seen = useRef(items.length);

  useEffect(() => {
    if (!atBottom && items.length > seen.current) setUnseen((n) => n + items.length - seen.current);
    seen.current = items.length;
  }, [items.length, atBottom]);

  const live = <div className="sr-only" aria-live="polite">{announce}</div>; // once per finished block, never per token (PLAN.md §9.3)

  // Alt+↑ / Alt+↓: jump between the cards that are waiting for the user (PLAN.md §9.2). The target may be scrolled out of
  // the virtualized list, so scroll first and focus once it exists.
  const waiting = useMemo(() => waitingIndexes(items), [items]);
  const at = useRef(-1);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !waiting.length) return;
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      at.current = down ? Math.min(at.current + 1, waiting.length - 1) : at.current < 0 ? waiting.length - 1 : Math.max(at.current - 1, 0);
      const index = waiting[at.current]!;
      list.current?.scrollToIndex({ index, align: 'center' });
      const focus = () => {
        const card = root.current?.querySelector(`[data-item-index="${index}"]`);
        const target = card?.querySelector<HTMLElement>('[role="alert"][tabindex], [role="alert"] input, [role="alert"] button');
        target?.focus();
        card?.scrollIntoView({ block: 'center' });
      };
      setTimeout(focus, virtualize ? 120 : 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [waiting, virtualize]);

  if (!virtualize) {
    return (
      <div ref={root} role="log" aria-label={strings.transcript.region} aria-live="off" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-3 px-4 py-4">
          {items.map((item, i) => <div key={keyOf(item)} data-item-index={i}><Card item={item} debug={debug} on={on} /></div>)}
        </div>
        {live}
      </div>
    );
  }

  return (
    <div ref={root} role="log" aria-label={strings.transcript.region} aria-live="off" className="relative min-h-0 flex-1">
      <Virtuoso
        ref={list}
        className="h-full"
        data={items}
        computeItemKey={(_, item) => keyOf(item)}
        initialTopMostItemIndex={Math.max(items.length - 1, 0)}
        followOutput={(bottom) => (bottom ? 'auto' : false)}
        atBottomStateChange={(b) => { setAtBottom(b); if (b) setUnseen(0); }}
        increaseViewportBy={300}
        itemContent={(i, item) => (
          <div data-item-index={i} className="mx-auto w-full max-w-[780px] px-4 py-1.5">
            <Card item={item} debug={debug} on={on} />
          </div>
        )}
      />
      {!atBottom && (
        <button
          type="button"
          onClick={() => list.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth', align: 'end' })}
          className="enter press absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm shadow-lg hover:bg-well"
        >
          <ArrowDown aria-hidden className="size-4" />
          {strings.transcript.jumpLabel}
          {unseen > 0 && <span className="rounded-full bg-accent-fill px-1.5 text-xs text-on-accent">{unseen}</span>}
        </button>
      )}
      {live}
    </div>
  );
}

import { Check, LoaderCircle, X } from 'lucide-react';
import type { LaneEntry } from '../model.ts';
import type { SessionView } from '../state/reduce.ts';
import { strings } from '../strings.ts';
import { formatTokens } from '../text.ts';

const NONE: LaneEntry[] = [];

function ToolRow({ entry }: { entry: Extract<LaneEntry, { kind: 'tool' }> }) {
  const icon = entry.status === 'running' ? <LoaderCircle aria-hidden className="spin size-3.5 shrink-0 text-accent" />
    : entry.status === 'ok' ? <Check aria-hidden className="size-3.5 shrink-0 text-accent" />
    : <X aria-hidden className="size-3.5 shrink-0 text-danger" />;
  return (
    <details className="rounded-control border border-line bg-card">
      <summary className="flex min-h-8 cursor-pointer items-center gap-2 px-2 py-1 text-sm">
        {icon}
        <span className="font-medium">{entry.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted" title={entry.target}>{entry.target}</span>
      </summary>
      {entry.output !== undefined && (
        <pre tabIndex={0} aria-label={strings.lanes.output(entry.name)} className="max-h-48 overflow-auto border-t border-line bg-well p-2 font-mono text-sm leading-snug whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{entry.output}</pre>
      )}
    </details>
  );
}

/** The live log of one subagent: its words, its thinking and each tool it ran, in order. Plain text only, never HTML. */
export function LaneBody({ view, laneId }: { view?: SessionView; laneId: string }) {
  const lane = view?.tasks.find((t) => t.id === laneId);
  if (!view || !lane) return <p className="text-sm text-muted">{strings.lanes.gone}</p>;
  const entries = (lane.toolUseId && view.laneLogs[lane.toolUseId]) || NONE;
  return (
    <div className="grid gap-3">
      <p className="text-base [overflow-wrap:anywhere]">{lane.description}</p>
      <p className="text-sm text-muted"><span className="font-medium text-ink">{strings.lanes.state[lane.state]}</span> · {strings.lanes.detail(lane.toolUses, formatTokens(lane.tokens))}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{strings.lanes.nothingYet}</p>
      ) : (
        <ol aria-label={strings.lanes.log} className="grid gap-2">
          {entries.map((e) => (
            <li key={e.id}>
              {e.kind === 'tool' ? <ToolRow entry={e} />
                : e.kind === 'thinking' ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">{strings.lanes.thinking}</summary>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{e.text}</p>
                  </details>
                ) : <p className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

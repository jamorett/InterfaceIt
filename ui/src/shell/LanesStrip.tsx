import { Check, LoaderCircle, Square, X } from 'lucide-react';
import { useState } from 'react';
import type { LaneView } from '../model.ts';
import { strings } from '../strings.ts';
import { formatTokens, middleTruncate } from '../text.ts';

const MAX_VISIBLE = 6;

function StateIcon({ state }: { state: LaneView['state'] }) {
  if (state === 'running') return <LoaderCircle aria-hidden className="spin size-3.5 text-accent" />;
  if (state === 'completed') return <Check aria-hidden className="size-3.5 text-accent" />;
  if (state === 'failed') return <X aria-hidden className="size-3.5 text-danger" />;
  return <Square aria-hidden className="size-3.5 text-muted" />;
}

function Lane({ lane }: { lane: LaneView }) {
  return (
    <li className="enter flex shrink-0 items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-sm" style={{ marginLeft: Math.min(lane.depth, 3) * 8 }}>
      <StateIcon state={lane.state} />
      <span className="font-medium">{lane.type}</span>
      <span className="text-muted" title={lane.description}>{middleTruncate(lane.description, 28)}</span>
      <span className="text-muted">{strings.lanes.state[lane.state]} · {strings.lanes.detail(lane.toolUses, formatTokens(lane.tokens))}</span>
    </li>
  );
}

/** One pill per subagent; with more than six, the rest fold into "+N more" (PLAN.md §7.4, §10). */
export function LanesStrip({ lanes }: { lanes: LaneView[] }) {
  const [all, setAll] = useState(false);
  if (!lanes.length) return null;
  const shown = all ? lanes : lanes.slice(0, MAX_VISIBLE);
  const hidden = lanes.length - shown.length;
  return (
    <ul aria-label={strings.lanes.region} className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
      {shown.map((l) => <Lane key={l.id} lane={l} />)}
      {hidden > 0 && (
        <li className="shrink-0">
          <button type="button" onClick={() => setAll(true)} className="press rounded-full border border-line px-3 py-1 text-sm text-accent hover:bg-well">
            {strings.lanes.more(hidden)}
          </button>
        </li>
      )}
    </ul>
  );
}

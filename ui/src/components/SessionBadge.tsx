import { Circle, Diamond, Hourglass, Minimize2, RefreshCw, Square, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { SessionState } from '../model.ts';
import { strings } from '../strings.ts';

// Status is never colour alone: every state has its own icon and a text label (PLAN.md §5, §6.2).
const look: Record<SessionState, { Icon: LucideIcon; box: string; icon: string }> = {
  idle: { Icon: Circle, box: 'text-muted', icon: '' },
  running: { Icon: Circle, box: 'text-accent', icon: 'fill-current breathe' },
  awaiting_permission: { Icon: Diamond, box: 'bg-attention text-on-attention px-2', icon: 'fill-current' },
  awaiting_answer: { Icon: Diamond, box: 'bg-attention text-on-attention px-2', icon: 'fill-current' },
  compacting: { Icon: Minimize2, box: 'text-accent', icon: 'breathe' },
  retrying: { Icon: RefreshCw, box: 'text-caution', icon: '' },
  rate_limited: { Icon: Hourglass, box: 'text-caution', icon: '' },
  error: { Icon: TriangleAlert, box: 'text-danger', icon: '' },
  ended: { Icon: Square, box: 'text-muted', icon: '' },
};

export function SessionBadge({ state, labelHidden = false }: { state: SessionState; labelHidden?: boolean }) {
  const { Icon, box, icon } = look[state];
  const label = strings.state[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full text-sm font-medium ${box}`} role="status">
      <Icon aria-hidden className={`size-3.5 ${icon}`} />
      <span className={labelHidden ? 'sr-only' : ''}>{label}</span>
    </span>
  );
}

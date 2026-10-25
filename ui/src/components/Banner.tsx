import { Info, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'info' | 'attention' | 'danger';

const tones: Record<Tone, { box: string; Icon: LucideIcon }> = {
  info: { box: 'border-line bg-card text-ink', Icon: Info },
  attention: { box: 'border-caution bg-attention text-on-attention', Icon: TriangleAlert },
  danger: { box: 'border-danger bg-card text-ink', Icon: WifiOff },
};

/** A full-width notice (disconnected, retrying, rate limited, bypass warning). Text is always spelled out; the icon only supports it. */
export function Banner({ tone, icon, children, action, live = 'polite' }: { tone: Tone; icon?: LucideIcon; children: ReactNode; action?: ReactNode; live?: 'polite' | 'assertive' | 'off' }) {
  const { box, Icon } = tones[tone];
  const I = icon ?? Icon;
  return (
    <div role={live === 'assertive' ? 'alert' : 'status'} aria-live={live} className={`enter flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-base ${box}`}>
      <I aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</p>
      {action}
    </div>
  );
}

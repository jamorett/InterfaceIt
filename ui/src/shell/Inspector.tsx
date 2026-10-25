import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../components/Button.tsx';
import { strings } from '../strings.ts';

type Props = {
  open: boolean;
  /** docked: a column beside the transcript · otherwise a sheet over it (full screen on narrow windows) */
  docked: boolean;
  instant?: boolean;
  title?: string;
  onClose?: () => void;
  children?: ReactNode;
};

export function Inspector({ open, docked, instant = false, title = strings.inspector.title, onClose, children }: Props) {
  const header = (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
      <h2 className="min-w-0 flex-1 truncate text-md font-semibold">{title}</h2>
      <IconButton label={strings.inspector.close} onClick={onClose}><X aria-hidden className="size-5" /></IconButton>
    </div>
  );
  if (docked) {
    if (!open) return null;
    return <aside aria-label={title} className="flex w-[420px] shrink-0 flex-col border-l border-line bg-paper">{header}<div className="min-h-0 flex-1 overflow-auto p-3">{children}</div></aside>;
  }
  const motion = instant ? 'duration-0' : open ? 'duration-[var(--dur-base)]' : 'duration-[var(--dur-quick)]';
  return (
    <div className={`absolute inset-0 z-30 ${open ? 'visible' : 'pointer-events-none invisible [transition:visibility_0s_linear_var(--dur-quick)]'}`} inert={!open}>
      <button type="button" tabIndex={-1} aria-label={strings.inspector.close} onClick={onClose} className={`absolute inset-0 bg-ink/40 transition-opacity ${motion} ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside
        aria-label={title}
        className={`absolute inset-y-0 right-0 flex w-[min(420px,100%)] flex-col border-l border-line bg-paper transition-transform ease-[var(--ease-drawer)] ${motion} ${open ? 'translate-x-0' : 'translate-x-full'} @max-tablet:w-full`}
      >
        {header}
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </aside>
    </div>
  );
}

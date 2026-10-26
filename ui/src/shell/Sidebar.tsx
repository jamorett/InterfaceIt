import { Plus, Search, X } from 'lucide-react';
import { Fragment } from 'react';
import { IconButton } from '../components/Button.tsx';
import { SessionBadge } from '../components/SessionBadge.tsx';
import type { SessionSummary } from '../model.ts';
import { strings } from '../strings.ts';

type Props = {
  sessions: SessionSummary[];
  activeId: string;
  /** full: 260 px column · rail: 56 px icons · drawer: slides over the content */
  variant: 'full' | 'rail' | 'drawer';
  open?: boolean;
  /** true when opened or closed by a keyboard shortcut: no animation for repeated keyboard actions */
  instant?: boolean;
  onClose?: () => void;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  onCloseSession?: (id: string) => void;
};

function List({ sessions, activeId, rail, onSelect, onCloseSession }: { sessions: SessionSummary[]; activeId: string; rail: boolean; onSelect?: (id: string) => void; onCloseSession?: (id: string) => void }) {
  const projects = [...new Set(sessions.map((s) => s.project))];
  return (
    <nav aria-label={strings.sidebar.title} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-3 pl-3 pb-3">
      {projects.map((project) => (
        <Fragment key={project}>
          {!rail && <h2 className="mt-5 mb-1.5 truncate pr-4 pl-3 text-xs font-semibold tracking-wider text-muted uppercase">{project}</h2>}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {sessions.filter((s) => s.project === project).map((s) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect?.(s.id)}
                  aria-current={s.id === activeId ? 'page' : undefined}
                  title={rail ? `${s.title} (${strings.state[s.state]})` : undefined}
                  className={`press hoverable flex min-h-9 w-full rounded-control py-2 pr-7 pl-3 text-left text-base pointer-coarse:min-h-11 ${s.id === activeId ? 'bg-card shadow-card' : ''} ${rail ? 'items-center justify-center' : 'flex-col gap-1'}`}
                >
                  {!rail && <span className={`truncate ${s.live ? 'pr-6' : 'pr-1'} ${s.id === activeId ? 'font-medium' : ''}`}>{s.title}</span>}
                  <span className="flex items-center gap-2">
                    <SessionBadge state={s.state} labelHidden={rail} />
                    {!rail && <span className="ml-auto shrink-0 text-xs text-muted">{s.updated}</span>}
                  </span>
                </button>
                {!rail && s.live && (
                  <button
                    type="button"
                    aria-label={strings.sidebar.closeSession(s.title)}
                    title={strings.sidebar.closeSession(s.title)}
                    onClick={() => onCloseSession?.(s.id)}
                    className="press absolute top-1.5 right-3 flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-line hover:text-ink focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

export function Sidebar({ sessions, activeId, variant, open = false, instant = false, onClose, onSelect, onNew, onCloseSession }: Props) {
  const rail = variant === 'rail';
  const body = (
    <>
      {!rail && (
        <div className="flex items-center gap-2 pr-4 pl-3 pt-3 pb-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{strings.sidebar.search}</span>
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted" />
            <input type="search" placeholder={strings.sidebar.search} className="min-h-9 w-full rounded-control border border-line bg-card pr-2 pl-8 text-base placeholder:text-muted pointer-coarse:min-h-11" />
          </label>
          {variant === 'drawer' && <IconButton label={strings.sidebar.close} onClick={onClose}><X aria-hidden className="size-5" /></IconButton>}
        </div>
      )}
      <div className={rail ? 'flex justify-center p-2' : 'pr-4 pl-3 pb-2'}>
        <IconButton label={strings.sidebar.newSession} onClick={onNew} className={rail ? '' : 'w-full justify-start gap-2 px-3'}>
          <Plus aria-hidden className="size-5" />
          {!rail && <span className="text-base">{strings.sidebar.newSession}</span>}
        </IconButton>
      </div>
      <List sessions={sessions} activeId={activeId} rail={rail} onSelect={(id) => { onSelect?.(id); if (variant === 'drawer') onClose?.(); }} onCloseSession={onCloseSession} />
    </>
  );

  if (variant !== 'drawer') {
    return <aside aria-label={strings.sidebar.title} className={`flex shrink-0 flex-col border-r border-line bg-well ${rail ? 'w-14' : 'w-[272px]'}`}>{body}</aside>;
  }
  // Drawer: exits leave faster than they enter, and a keyboard toggle skips the motion entirely.
  const motion = instant ? 'duration-0' : open ? 'duration-[var(--dur-base)]' : 'duration-[var(--dur-quick)]';
  return (
    <div className={`absolute inset-0 z-30 ${open ? 'visible' : 'pointer-events-none invisible [transition:visibility_0s_linear_var(--dur-quick)]'}`} inert={!open}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={strings.sidebar.close}
        onClick={onClose}
        className={`absolute inset-0 bg-ink/40 transition-opacity ${motion} ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <aside
        aria-label={strings.sidebar.title}
        className={`absolute inset-y-0 left-0 flex w-[min(300px,88%)] flex-col border-r border-line bg-well transition-transform ease-[var(--ease-drawer)] ${motion} ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {body}
      </aside>
    </div>
  );
}

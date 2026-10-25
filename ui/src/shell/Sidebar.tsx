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
};

function List({ sessions, activeId, rail }: { sessions: SessionSummary[]; activeId: string; rail: boolean }) {
  const projects = [...new Set(sessions.map((s) => s.project))];
  return (
    <nav aria-label={strings.sidebar.title} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {projects.map((project) => (
        <Fragment key={project}>
          {!rail && <h2 className="mt-3 mb-1 truncate px-2 text-xs font-semibold tracking-wide text-muted uppercase">{project}</h2>}
          <ul className="grid gap-0.5">
            {sessions.filter((s) => s.project === project).map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={s.id === activeId ? 'page' : undefined}
                  title={rail ? `${s.title} (${strings.state[s.state]})` : undefined}
                  className={`press hoverable flex min-h-9 rounded-control px-2 py-1.5 text-base pointer-coarse:min-h-11 ${s.id === activeId ? 'bg-well' : ''} ${rail ? 'items-center justify-center' : 'flex-col gap-0.5'}`}
                >
                  {!rail && <span className={`truncate ${s.id === activeId ? 'font-medium' : ''}`}>{s.title}</span>}
                  <span className="flex items-center gap-2">
                    <SessionBadge state={s.state} labelHidden={rail} />
                    {!rail && <span className="ml-auto shrink-0 text-xs text-muted">{s.updated}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

export function Sidebar({ sessions, activeId, variant, open = false, instant = false, onClose }: Props) {
  const rail = variant === 'rail';
  const body = (
    <>
      {!rail && (
        <div className="flex items-center gap-2 p-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{strings.sidebar.search}</span>
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted" />
            <input type="search" placeholder={strings.sidebar.search} className="min-h-9 w-full rounded-control border border-line bg-card pr-2 pl-8 text-base placeholder:text-muted pointer-coarse:min-h-11" />
          </label>
          {variant === 'drawer' && <IconButton label={strings.sidebar.close} onClick={onClose}><X aria-hidden className="size-5" /></IconButton>}
        </div>
      )}
      <div className={rail ? 'flex justify-center p-2' : 'px-2 pb-1'}>
        <IconButton label={strings.sidebar.newSession} className={rail ? '' : 'w-full justify-start gap-2 px-2'}>
          <Plus aria-hidden className="size-5" />
          {!rail && <span className="text-base">{strings.sidebar.newSession}</span>}
        </IconButton>
      </div>
      <List sessions={sessions} activeId={activeId} rail={rail} />
    </>
  );

  if (variant !== 'drawer') {
    return <aside aria-label={strings.sidebar.title} className={`flex shrink-0 flex-col border-r border-line bg-paper ${rail ? 'w-14' : 'w-[260px]'}`}>{body}</aside>;
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
        className={`absolute inset-y-0 left-0 flex w-[min(300px,88%)] flex-col border-r border-line bg-paper transition-transform ease-[var(--ease-drawer)] ${motion} ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {body}
      </aside>
    </div>
  );
}

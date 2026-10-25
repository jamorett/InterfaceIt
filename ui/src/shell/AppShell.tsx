import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionSummary } from '../model.ts';
import { Header, type HeaderProps } from './Header.tsx';
import { Inspector } from './Inspector.tsx';
import { Sidebar } from './Sidebar.tsx';
import { StatusSummary } from './StatusSummary.tsx';
import { INSPECTOR_DOCK_MIN, TierContext, tierFor, useMeasuredWidth } from './tier.ts';

type Props = {
  sessions: SessionSummary[];
  activeId: string;
  header: HeaderProps;
  /** notices under the header: disconnected, rate limit, retrying, bypass warning */
  banners?: ReactNode;
  lanes?: ReactNode;
  /** transcript or a full-area screen */
  children: ReactNode;
  /** todo strip + composer */
  bottom?: ReactNode;
  inspector?: ReactNode;
  inspectorTitle?: string;
  inspectorOpen?: boolean;
  className?: string;
};

/**
 * The four tiers of PLAN.md §7.3, measured on the shell itself:
 * desktop ≥1440 sidebar + transcript + docked inspector · laptop ≥1024 icon rail ·
 * tablet ≥720 sidebar is a drawer, inspector a sheet · narrow <720 single column, status folds into the header menu.
 */
export function AppShell({ sessions, activeId, header, banners, lanes, children, bottom, inspector, inspectorTitle, inspectorOpen = false, className = 'h-full' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref);
  const tier = tierFor(width);
  const [drawer, setDrawer] = useState(false);
  const [wide, setWide] = useState<boolean | undefined>(undefined);
  const [inspectorIsOpen, setInspector] = useState(inspectorOpen);
  const [viaKeyboard, setViaKeyboard] = useState(false);

  const docked = tier === 'desktop' || tier === 'laptop';
  const sidebarWide = wide ?? tier === 'desktop';
  const inspectorDocked = docked && width >= INSPECTOR_DOCK_MIN;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setViaKeyboard(true);
        if (docked) setWide((w) => !(w ?? tier === 'desktop'));
        else setDrawer((d) => !d);
      } else if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setViaKeyboard(true);
        setInspector((o) => !o);
      } else if (e.key === 'Escape' && (drawer || (inspectorIsOpen && !inspectorDocked))) {
        // closes the topmost sheet first; stopping a running turn is the next Esc (PLAN.md §9.2)
        setViaKeyboard(true);
        if (inspectorIsOpen && !inspectorDocked) setInspector(false);
        else setDrawer(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, tier, drawer, inspectorIsOpen, inspectorDocked]);

  // clicks are animated, keyboard toggles are not
  const click = (fn: () => void) => () => { setViaKeyboard(false); fn(); };

  return (
    <TierContext.Provider value={tier}>
      <div ref={ref} className={`@container relative flex flex-col overflow-hidden bg-paper text-ink ${className}`}>
        <div className="flex min-h-0 flex-1">
          {docked && <Sidebar sessions={sessions} activeId={activeId} variant={sidebarWide ? 'full' : 'rail'} />}
          <div className="flex min-w-0 flex-1 flex-col">
            <Header
              {...header}
              onMenu={click(() => setDrawer(true))}
              onToggleInspector={click(() => setInspector((o) => !o))}
              inspectorOpen={inspectorIsOpen}
            />
            {banners}
            <main className="flex min-h-0 flex-1 flex-col">
              {lanes}
              {children}
              {bottom}
            </main>
          </div>
          <Inspector open={inspectorIsOpen} docked={inspectorDocked} instant={viaKeyboard} title={inspectorTitle} onClose={click(() => setInspector(false))}>
            {inspector}
          </Inspector>
        </div>
        {tier !== 'narrow' && (
          <footer className="border-t border-line bg-card px-4 py-1.5">
            <StatusSummary {...header.status} />
          </footer>
        )}
        {!docked && <Sidebar sessions={sessions} activeId={activeId} variant="drawer" open={drawer} instant={viaKeyboard} onClose={click(() => setDrawer(false))} />}
      </div>
    </TierContext.Provider>
  );
}

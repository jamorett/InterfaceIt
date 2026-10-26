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
  onSelectSession?: (id: string) => void;
  onNewSession?: () => void;
  onCloseSession?: (id: string) => void;
  /** Esc with nothing to close: the session screen uses it to stop a running turn */
  /** changes whenever something asks the panel to open (a card's "open in side panel") */
  openInspectorSignal?: number;
  onEscape?: () => void;
  /** Ctrl+Shift+M */
  onCycleMode?: () => void;
  className?: string;
};

/**
 * The four tiers of PLAN.md §7.3, measured on the shell itself:
 * desktop ≥1440 sidebar + transcript + docked inspector · laptop ≥1024 icon rail ·
 * tablet ≥720 sidebar is a drawer, inspector a sheet · narrow <720 single column, status folds into the header menu.
 */
export function AppShell({ sessions, activeId, header, banners, lanes, children, bottom, inspector, inspectorTitle, inspectorOpen = false, onSelectSession, onNewSession, onCloseSession, openInspectorSignal, onEscape, onCycleMode, className = 'h-full' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref);
  const tier = tierFor(width);
  const [drawer, setDrawer] = useState(false);
  const [wide, setWide] = useState<boolean | undefined>(undefined);
  const [inspectorIsOpen, setInspector] = useState(inspectorOpen);
  const [viaKeyboard, setViaKeyboard] = useState(false);

  useEffect(() => {
    if (openInspectorSignal) {
      setViaKeyboard(false);
      setInspector(true);
    }
  }, [openInspectorSignal]);

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
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        onCycleMode?.();
      } else if (e.key === 'Escape') {
        // PLAN.md §9.2: the topmost sheet closes first; then a half-typed message loses focus; only then does Esc stop the turn
        if (drawer || (inspectorIsOpen && !inspectorDocked)) {
          setViaKeyboard(true);
          if (inspectorIsOpen && !inspectorDocked) setInspector(false);
          else setDrawer(false);
        } else if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
          if (e.target.value) e.target.blur();
          else onEscape?.();
        } else onEscape?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, tier, drawer, inspectorIsOpen, inspectorDocked, onEscape, onCycleMode]);

  // clicks are animated, keyboard toggles are not
  const click = (fn: () => void) => () => { setViaKeyboard(false); fn(); };

  return (
    <TierContext.Provider value={tier}>
      <div ref={ref} className={`@container relative flex flex-col overflow-hidden bg-paper text-ink ${className}`}>
        <div className="flex min-h-0 flex-1">
          {docked && <Sidebar sessions={sessions} activeId={activeId} variant={sidebarWide ? 'full' : 'rail'} onSelect={onSelectSession} onNew={onNewSession} onCloseSession={onCloseSession} />}
  <div className="flex min-w-0 flex-1 flex-col">
            <Header
              {...header}
              onMenu={click(() => setDrawer(true))}
              onToggleInspector={inspector ? click(() => setInspector((o) => !o)) : undefined}
              inspectorOpen={inspectorIsOpen}
            />
            {banners}
            <main className="flex min-h-0 flex-1 flex-col">
              {lanes}
              {children}
              {bottom}
            </main>
          </div>
          {inspector && (
            <Inspector open={inspectorIsOpen} docked={inspectorDocked} instant={viaKeyboard} title={inspectorTitle} onClose={click(() => setInspector(false))}>
              {inspector}
            </Inspector>
          )}
        </div>
        {tier !== 'narrow' && (
          <footer className="border-t border-line bg-well px-4 py-1.5 tabular-nums">
            <StatusSummary {...header.status} />
          </footer>
        )}
        {!docked && <Sidebar sessions={sessions} activeId={activeId} variant="drawer" open={drawer} instant={viaKeyboard} onClose={click(() => setDrawer(false))} onSelect={onSelectSession} onNew={onNewSession} onCloseSession={onCloseSession} />}
</div>
    </TierContext.Provider>
  );
}

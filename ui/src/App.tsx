import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SessionScreen } from './SessionScreen.tsx';
import { askNotificationPermissionOnce } from './state/notify.ts';
import { readToken } from './state/token.ts';
import { useStore } from './state/store.ts';
import { NoLink } from './states/NoLink.tsx';
import { Onboarding, type OnboardingKind } from './states/Onboarding.tsx';
import { ProjectPicker } from './states/ProjectPicker.tsx';
import { Splash } from './states/Splash.tsx';
import { strings } from './strings.ts';

/** A tab title that shows when any session needs you, so it is noticed from another tab (PLAN.md §5). */
function useTabTitle() {
  const needs = useStore((s) => Object.values(s.views).filter((v) => v.state === 'awaiting_permission' || v.state === 'awaiting_answer').length);
  useEffect(() => {
    document.title = needs ? `◆ (${needs}) ${strings.appName}` : strings.appName;
  }, [needs]);
}

const NO_PROJECTS: string[] = []; // a stable value: a fresh [] on every call would look like a change each time

export function App() {
  const conn = useStore((s) => s.conn);
  const everReady = useStore((s) => s.everReady);
  const preflight = useStore((s) => s.preflight);
  const view = useStore((s) => (s.activeId ? s.views[s.activeId] : undefined));
  const picker = useStore(useShallow((s) => ({ recent: s.preflight?.recentProjects ?? NO_PROJECTS, trusting: s.trusting, notice: s.notice, busy: s.starting })));
  const past = useStore((s) => s.past);
  const views = useStore((s) => s.views);
  // sessions running in the bridge that this tab has not opened (started in another tab, or before it was closed)
  const running = useMemo(() => past.filter((p) => p.live && !views[p.id]).map((p) => ({ id: p.id, title: p.title, cwd: p.cwd })), [past, views]);
  useTabTitle();

  useEffect(() => askNotificationPermissionOnce(), []);
  useEffect(() => {
    const token = readToken();
    if (!token) useStore.setState({ conn: 'no-link' });
    else useStore.getState().connect(token);
  }, []);

  const act = useStore.getState();
  if (conn === 'no-link') return <NoLink />;
  if (!everReady || !preflight) return <Splash />;

  const problem: OnboardingKind | undefined = !preflight.cliFound ? 'cliMissing' : preflight.cliTooOld ? 'cliOld' : !preflight.loggedIn ? 'notLoggedIn' : undefined;
  if (problem) return <div className="h-dvh"><Onboarding kind={problem} command={problem === 'notLoggedIn' ? preflight.loginCommand : undefined} onCheck={act.checkAgain} /></div>;

  if (!view) {
    return (
      <div className="h-dvh">
        <ProjectPicker {...picker} running={running} onAttach={(id) => { const info = past.find((p) => p.id === id); if (info) act.attachLive(info); }} onOpen={act.start} onTrust={act.trustAndStart} onBack={act.cancelTrust} />
      </div>
    );
  }
  return <div className="h-dvh"><SessionScreen key={view.id} view={view} /></div>;
}

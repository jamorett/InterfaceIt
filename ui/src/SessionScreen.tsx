import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Banner } from './components/Banner.tsx';
import { Button } from './components/Button.tsx';
import { Composer } from './composer/Composer.tsx';
import { ago, resetsAt } from './format.ts';
import type { LimitWindow, SessionSummary } from './model.ts';
import { AppShell } from './shell/AppShell.tsx';
import { InspectorBody } from './shell/InspectorBody.tsx';
import { InspectorContext, type InspectorContent } from './shell/inspector.ts';
import { LanesStrip } from './shell/LanesStrip.tsx';
import { TodoStrip } from './shell/TodoStrip.tsx';
import { basename } from './state/describe.ts';
import { nextMode } from './state/modes.ts';
import { lanesOf, type SessionView } from './state/reduce.ts';
import { useStore } from './state/store.ts';
import { CrashedSession } from './states/CrashedSession.tsx';
import { EmptySession } from './states/EmptySession.tsx';
import { strings } from './strings.ts';
import { Transcript } from './transcript/Transcript.tsx';

const titleOf = (v: SessionView) => {
  const first = v.items.find((i) => i.kind === 'user');
  return first?.kind === 'user' ? first.text.slice(0, 60) : 'New session';
};

const DEFAULT_MODELS = [{ value: 'default', label: 'Default' }];

export function SessionScreen({ view }: { view: SessionView }) {
  const { conn, attempt, past, views, order, dismissedLimit, debug, files } = useStore(useShallow((s) => ({ conn: s.conn, attempt: s.attempt, past: s.past, views: s.views, order: s.order, dismissedLimit: s.dismissedLimit, debug: s.debug, files: s.files })));
  const act = useStore.getState();
  // cards open this panel (a diff, a whole output, an image) through InspectorContext
  const [panel, setPanel] = useState<InspectorContent>();
  const [panelSignal, setPanelSignal] = useState(0);
  const openPanel = (c: InspectorContent) => { setPanel(c); setPanelSignal((n) => n + 1); };

  const live: SessionSummary[] = order.flatMap((id) => (views[id] ? [{ id, project: basename(views[id]!.cwd), title: titleOf(views[id]!), state: views[id]!.state, updated: 'now' }] : []));
  const liveIds = new Set(order.flatMap((id) => [id, views[id]?.init?.sdkSessionId]));
  const stored: SessionSummary[] = past.filter((p) => !liveIds.has(p.id)).slice(0, 50).map((p) => ({ id: p.id, project: basename(p.cwd), title: p.title, state: p.live ? 'running' : 'idle', updated: p.live ? 'now' : ago(p.updated) }));

  const window = (label: string, w?: { utilization: number; resetsAt: number }): LimitWindow[] => (w ? [{ label, utilization: w.utilization, resetsAt: resetsAt(w.resetsAt) }] : []);
  const limits = [...window('5h', view.limits.fiveHour), ...window('7d', view.limits.sevenDay)];
  const hottest = Math.round(Math.max(0, ...limits.map((l) => l.utilization)) * 100);
  const resets = view.limits.resetsAt ? resetsAt(view.limits.resetsAt) : '';

  const offline = conn !== 'ready';
  const disabledReason = offline ? strings.composer.disabledOffline : view.state === 'rate_limited' ? strings.composer.disabledLimit : view.state === 'ended' ? strings.composer.disabledEnded : undefined;
  const showWarning = view.limits.status === 'allowed_warning' && view.limits.resetsAt !== dismissedLimit;
  const models = view.models.length ? view.models.map((m) => ({ value: m.value, label: m.label })) : DEFAULT_MODELS;
  const q = view.items.length === 0 && view.state === 'idle' && !view.crashed;

  const select = (id: string) => {
    if (views[id]) return act.select(id);
    const info = past.find((p) => p.id === id);
    if (info?.live) act.attachLive(info);
    else if (info) act.openPast(info);
  };

  return (
    <InspectorContext.Provider value={openPanel}>
    <AppShell
      inspector={panel ? <InspectorBody content={panel} /> : undefined}
      inspectorTitle={panel?.title}
      openInspectorSignal={panelSignal}
      sessions={[...live, ...stored]}
      activeId={view.id}
      onSelectSession={select}
      onNewSession={act.newSession}
      onEscape={() => { if (['running', 'awaiting_permission', 'awaiting_answer', 'compacting', 'retrying'].includes(view.state)) act.stop(); }}
      onCycleMode={() => act.setMode(nextMode(view.mode))}
      header={{
        project: basename(view.cwd) || view.cwd,
        state: view.state,
        model: view.init?.model ?? 'default',
        models,
        mode: view.mode,
        onModel: act.setModel,
        onMode: act.setMode,
        status: { state: view.state, context: view.context, limits, background: view.background || undefined },
      }}
      banners={
        <>
          {view.mode === 'bypassPermissions' && <Banner tone="attention">{strings.header.bypassWarning}</Banner>}
          {offline && <Banner tone="danger" live="assertive">{strings.banner.disconnected(attempt)} {strings.banner.draftKept}</Banner>}
          {view.state === 'rate_limited' && <Banner tone="attention" live="assertive">{strings.limits.reached(resets ? `at ${resets}` : 'later')}</Banner>}
          {showWarning && view.limits.resetsAt !== undefined && (
            <Banner tone="attention" action={<Button variant="attention" onClick={() => act.dismissLimit(view.limits.resetsAt!)}>{strings.banner.dismiss}</Button>}>
              {strings.limits.warning(hottest, resets)}
            </Banner>
          )}
          {view.retrying && <Banner tone="info">{strings.banner.retrying(view.retrying.attempt, view.retrying.max)}</Banner>}
        </>
      }
      lanes={<LanesStrip lanes={lanesOf(view)} />}
      bottom={
        <>
          <TodoStrip items={view.todos} />
          <Composer
            key={view.id}
            state={view.state}
            queued={view.queued.map((x) => x.text)}
            suggestion={view.suggestion}
            disabledReason={disabledReason}
            commands={view.commands.length ? view.commands : (view.init?.slashCommands ?? []).map((name) => ({ name }))}
            files={files}
            onSearchFiles={act.searchFiles}
            onSend={act.prompt}
            onStop={act.stop}
            onRemoveQueued={(i) => view.queued[i] && act.unqueue(view.queued[i]!.id)}
          />
        </>
      }
    >
      {view.crashed ? (
        <CrashedSession message={view.crashed} onResume={act.resumeCrashed} />
      ) : q ? (
        <EmptySession onPick={act.prompt} />
      ) : (
        <Transcript key={view.id} items={view.items} debug={debug} announce={view.announce} on={{ onPermission: act.decide, onAnswer: act.answer, onPlan: act.decidePlan, onFull: act.fetchFull }} />
      )}
    </AppShell>
    </InspectorContext.Provider>
  );
}

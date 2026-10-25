import { useState, type ReactNode } from 'react';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Composer } from '../composer/Composer.tsx';
import type { PermissionMode, SessionState, TodoItem, TranscriptItem } from '../model.ts';
import { AppShell } from '../shell/AppShell.tsx';
import { LanesStrip } from '../shell/LanesStrip.tsx';
import { TodoStrip } from '../shell/TodoStrip.tsx';
import { CrashedSession } from '../states/CrashedSession.tsx';
import { EmptySession } from '../states/EmptySession.tsx';
import { Onboarding } from '../states/Onboarding.tsx';
import { ProjectPicker } from '../states/ProjectPicker.tsx';
import { Splash } from '../states/Splash.tsx';
import { strings } from '../strings.ts';
import { Transcript } from '../transcript/Transcript.tsx';
import * as fx from './fixtures.ts';
import type { ScenarioName } from './scenario-names.ts';

type SessionProps = {
  state: SessionState;
  items?: TranscriptItem[];
  mode?: PermissionMode;
  banners?: ReactNode;
  lanes?: boolean;
  todo?: TodoItem[];
  main?: ReactNode;
  queued?: string[];
  suggestion?: string;
  disabledReason?: string;
  draft?: string;
  inspectorOpen?: boolean;
  debug?: boolean;
  background?: number;
};

/** Dev-only: lets the scenarios react to clicks so the cards can be exercised, not just looked at. */
function Live({ items, debug }: { items: TranscriptItem[]; debug?: boolean }) {
  const [list, setList] = useState(items);
  const patch = (id: string, change: Record<string, unknown>) =>
    setList((l) => l.map((i) => ('view' in i && i.view.id === id ? ({ ...i, view: { ...i.view, ...change } } as TranscriptItem) : i)));
  return (
    <Transcript
      items={list}
      debug={debug}
      on={{
        onPermission: (id, decision, denyReason) => patch(id, { decision, denyReason, instant: true }),
        onAnswer: (id, answer) => patch(id, { answer }),
        onPlan: (id, decision) => patch(id, { decision }),
      }}
    />
  );
}

function Session(p: SessionProps) {
  return (
    <AppShell
      sessions={fx.sessions}
      activeId="s1"
      inspectorOpen={p.inspectorOpen}
      inspectorTitle="Edit ui/src/store.ts"
      inspector={
        <pre tabIndex={0} aria-label="Full change" className="overflow-auto rounded-control bg-well p-2 font-mono text-sm leading-snug">
          {fx.diffForInspector.map((l, i) => (
            <span key={i} className={`block whitespace-pre ${l.kind === 'add' ? 'bg-accent/15' : l.kind === 'del' ? 'bg-danger/15' : ''}`}>
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}{l.text}
            </span>
          ))}
        </pre>
      }
      header={{
        project: 'ClaudeInterface',
        branch: 'main',
        state: p.state,
        model: 'default',
        models: fx.models,
        mode: p.mode ?? 'default',
        status: { state: p.state, context: fx.context, limits: fx.limits, background: p.background },
      }}
      banners={
        <>
          {p.mode === 'bypassPermissions' && <Banner tone="attention">{strings.header.bypassWarning}</Banner>}
          {p.banners}
        </>
      }
      lanes={p.lanes ? <LanesStrip lanes={fx.lanes} /> : undefined}
      bottom={
        <>
          {p.todo && <TodoStrip items={p.todo} />}
          <Composer state={p.state} queued={p.queued} suggestion={p.suggestion} disabledReason={p.disabledReason} initialDraft={p.draft} />
        </>
      }
    >
      {p.main ?? <Live items={p.items ?? fx.baseTranscript} debug={p.debug} />}
    </AppShell>
  );
}

const check = <Button variant="secondary">{strings.onboarding.check}</Button>;

/** Every state of PLAN.md §7.1 plus the hostile content of §10. Rendered by /dev/shell?state=<name> and tested at 4 widths in light and dark. */
export const scenarios: Record<ScenarioName, () => ReactNode> = {
  splash: () => <Splash />,
  'onboarding-cli-missing': () => <Onboarding kind="cliMissing" />,
  'onboarding-cli-old': () => <Onboarding kind="cliOld" />,
  'onboarding-login': () => <Onboarding kind="notLoggedIn" />,
  'project-picker': () => <ProjectPicker recent={fx.recentProjects} />,
  'project-trust': () => <ProjectPicker recent={fx.recentProjects} trusting="C:\Users\someone\Desktop\brand-new-folder" />,
  empty: () => <Session state="idle" main={<EmptySession />} />,
  running: () => <Session state="running" items={fx.runningTranscript} queued={['Also update the README']} suggestion="Run the full test suite" background={1} />,
  idle: () => <Session state="idle" suggestion="Run the full test suite" />,
  'awaiting-permission': () => <Session state="awaiting_permission" items={fx.permissionTranscript} />,
  'awaiting-permission-person': () => (
    <Session state="awaiting_permission" items={[{ kind: 'user', id: 'u', text: 'Plan it first' }, { kind: 'permission', view: fx.askPerson }, { kind: 'permission', view: fx.permissionBash }]} />
  ),
  'awaiting-question': () => <Session state="awaiting_answer" items={[{ kind: 'user', id: 'u', text: 'Set up the theme' }, { kind: 'question', view: fx.question }, { kind: 'question', view: fx.questionMulti }]} />,
  'plan-review': () => <Session state="awaiting_permission" mode="plan" items={[{ kind: 'user', id: 'u', text: 'Plan the migration' }, { kind: 'plan', view: fx.plan }]} />,
  'todo-lanes': () => <Session state="running" items={fx.runningTranscript} lanes todo={fx.todos} />,
  disconnected: () => (
    <Session
      state="running"
      items={fx.baseTranscript}
      draft="Then also check the other tests"
      disabledReason={strings.composer.disabledOffline}
      banners={<Banner tone="danger" live="assertive">{strings.banner.disconnected(3)} {strings.banner.draftKept}</Banner>}
    />
  ),
  'rate-limited': () => (
    <Session
      state="rate_limited"
      items={fx.baseTranscript}
      disabledReason={strings.composer.disabledLimit}
      banners={<Banner tone="attention" live="assertive" action={check}>{strings.limits.reached('at 22:19')}</Banner>}
    />
  ),
  'limit-warning': () => <Session state="idle" banners={<Banner tone="attention">{strings.limits.warning(85, 'tomorrow 05:59')}</Banner>} />,
  retrying: () => <Session state="retrying" items={fx.runningTranscript} banners={<Banner tone="info">{strings.banner.retrying(2, 10)}</Banner>} />,
  crashed: () => <Session state="error" main={<CrashedSession message="Claude Code process exited with code 1" />} />,
  hostile: () => <Session state="idle" items={fx.hostileTranscript} debug />,
  'tool-failed': () => <Session state="error" items={fx.failedTranscript} />,
  bypass: () => <Session state="running" mode="bypassPermissions" items={fx.runningTranscript} />,
  inspector: () => <Session state="awaiting_permission" items={fx.permissionTranscript} inspectorOpen />,
};


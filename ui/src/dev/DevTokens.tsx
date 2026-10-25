import { useState, type ReactNode } from 'react';
import { PermissionCard } from '../cards/PermissionCard.tsx';
import { PlanReview } from '../cards/PlanReview.tsx';
import { QuestionCard } from '../cards/QuestionCard.tsx';
import { ToolCard } from '../cards/ToolCard.tsx';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { SessionBadge } from '../components/SessionBadge.tsx';
import type { SessionState } from '../model.ts';
import { duration, ease } from '../motion.ts';
import { ContextGauge, UsageMeter } from '../shell/Gauges.tsx';
import { LanesStrip } from '../shell/LanesStrip.tsx';
import { TodoStrip } from '../shell/TodoStrip.tsx';
import { getTheme, setTheme, type Theme } from '../theme.ts';
import { Transcript } from '../transcript/Transcript.tsx';
import * as fx from './fixtures.ts';
import { scenarioNames } from './scenario-names.ts';
import { useFakeSession } from './useFakeSession.ts';

const swatches: [alias: string, variable: string, role: string][] = [
  ['paper', '--bg', 'Page'], ['card', '--surface', 'Cards, composer'], ['well', '--surface-sunken', 'Code, terminal'],
  ['ink', '--text', 'Body text'], ['muted', '--text-muted', 'Meta, timestamps'],
  ['accent', '--primary', 'Links, focus, running'], ['accent-fill', '--primary-fill', 'Button background'], ['on-accent', '--primary-contrast', 'Text on buttons'],
  ['attention', '--attention', 'Needs you (nothing else uses it)'], ['on-attention', '--attention-text', 'Text on attention'],
  ['danger', '--danger', 'Errors, deny, failed'], ['caution', '--warning', 'Warnings, rules'], ['line', '--border', 'Dividers'],
];

const states: SessionState[] = ['idle', 'running', 'awaiting_permission', 'awaiting_answer', 'compacting', 'retrying', 'rate_limited', 'error', 'ended'];
const widths = [360, 720, 1024, 1440];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Replayable({ label, children }: { label: string; children: () => ReactNode }) {
  const [n, setN] = useState(0);
  return (
    <div className="grid gap-2">
      <div><Button onClick={() => setN((x) => x + 1)}>{label}</Button></div>
      <div key={n} className="max-w-[780px]">{children()}</div>
    </div>
  );
}

/** /dev/tokens: every token, the motion rules at work, every card state, a scripted live session, and the responsive shell. */
export function DevTokens() {
  const [theme, setT] = useState<Theme>(getTheme());
  const [scenario, setScenario] = useState('running');
  const [width, setWidth] = useState(1024);
  const session = useFakeSession();
  const choose = (t: Theme) => { setTheme(t); setT(t); };

  return (
    <main className="mx-auto max-w-[1100px] px-4 pt-6 pb-24">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Design tokens and states</h1>
        <div role="group" aria-label="Theme" className="ml-auto flex gap-1">
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <Button key={t} variant={theme === t ? 'primary' : 'secondary'} aria-pressed={theme === t} onClick={() => choose(t)}>{t[0]!.toUpperCase() + t.slice(1)}</Button>
          ))}
        </div>
      </header>
      <p className="mt-1 text-base text-muted">Palette given: cream, butter, teal, pine. Everything else is derived and contrast-tested.</p>

      <Section id="colours" title="Colour tokens">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {swatches.map(([alias, v, role]) => (
            <li key={v}>
              <span aria-hidden className="block h-12 rounded-control border border-line" style={{ background: `var(${v})` }} />
              <p className="mt-1 text-sm font-medium">{alias}</p>
              <p className="font-mono text-xs text-muted">{v}</p>
              <p className="text-xs text-muted">{role}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="type" title="Type, shape, motion tokens">
        <div className="grid gap-4 @container md:grid-cols-2">
          <div>
            {[['text-xl', 24], ['text-lg', 20], ['text-md', 16], ['text-base', 14], ['text-sm', 13], ['text-xs', 12]].map(([c, px]) => (
              <p key={c} className={String(c)}>{c} · {px}px · The quick brown fox jumps</p>
            ))}
            <p className="mt-2 font-mono text-base">Cascadia Code · const x = 42;</p>
          </div>
          <div className="grid content-start gap-2 text-sm">
            <p>Radius: <span className="inline-block h-6 w-12 rounded-control border border-line align-middle" /> 6 · <span className="inline-block h-6 w-12 rounded-card border border-line align-middle" /> 10</p>
            <p className="font-mono">{Object.entries(duration).map(([k, v]) => `${k} ${v}ms`).join(' · ')}</p>
            <p className="font-mono [overflow-wrap:anywhere]">{Object.entries(ease).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
            <p className="text-muted">Only transform, opacity and colour animate, and every curve eases out. Keyboard-driven actions never animate. Reduced motion keeps 100 ms fades.</p>
          </div>
        </div>
      </Section>

      <Section id="motion" title="Motion lab (press the buttons to replay)">
        <div className="grid gap-6">
          <Replayable label="Tool starts (rise and fade in)">{() => <ToolCard tool={{ id: 'm1', name: 'Bash', target: 'npm run build', status: 'running', elapsedSec: 3 }} />}</Replayable>
          <Replayable label="Tool fails (one 4 px shake, stays open)">{() => <ToolCard tool={{ id: 'm2', name: 'Bash', target: 'npm run lint', status: 'error', output: 'error: unused variable' }} />}</Replayable>
          <Replayable label="Claude needs you (one attention glow)">{() => <PermissionCard view={{ ...fx.permissionBash, id: 'm3' }} />}</Replayable>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Press me (scale 0.97)</Button>
            <span className="inline-flex items-center gap-2 text-sm"><SessionBadge state="running" /> breathes only while running</span>
          </div>
        </div>
      </Section>

      <Section id="live" title="Scripted session (fake events through the animation gate)">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={session.play}>Play live</Button>
          <Button onClick={session.replay}>Replay as history (no animation)</Button>
          <Button onClick={session.burst}>50 tools at once (burst guard)</Button>
          <span className="self-center"><SessionBadge state={session.state} /></span>
        </div>
        <div className="h-[420px] overflow-hidden rounded-card border border-line">
          <div className="flex h-full flex-col"><Transcript items={session.items} on={{ onPermission: session.decide }} /></div>
        </div>
      </Section>

      <Section id="states" title="Session states">
        <ul className="flex flex-wrap gap-4">
          {states.map((s) => <li key={s}><SessionBadge state={s} /></li>)}
        </ul>
      </Section>

      <Section id="cards" title="Cards">
        <div className="grid max-w-[780px] gap-3">
          <ToolCard tool={{ id: 'c1', name: 'Read', target: 'C:\\Users\\someone\\Desktop\\ClaudeInterface\\ui\\src\\store.ts', status: 'ok', elapsedSec: 0.4, output: 'export const store = 1;\n' }} />
          <ToolCard tool={{ id: 'c2', name: 'Bash', target: 'npm test', status: 'running', elapsedSec: 12 }} />
          <ToolCard tool={{ id: 'c3', name: 'Bash', target: 'npm run lint', status: 'error', output: 'error: unused variable\n' }} />
          <PermissionCard view={fx.permissionEdit} />
          <PermissionCard view={fx.askPerson} />
          <PermissionCard view={fx.permissionDone} />
          <PermissionCard view={fx.permissionDenied} />
          <QuestionCard view={fx.question} />
          <QuestionCard view={fx.questionMulti} />
          <PlanReview view={fx.plan} />
          <PlanReview view={{ ...fx.plan, id: 'pl2', decision: 'approved-manual' }} />
        </div>
      </Section>

      <Section id="strips" title="Strips and gauges">
        <div className="grid max-w-[780px] gap-3 rounded-card border border-line bg-card py-3">
          <LanesStrip lanes={fx.lanes} />
          <TodoStrip items={fx.todos} />
          <div className="flex flex-wrap items-center gap-6 px-4">
            <ContextGauge context={{ totalTokens: 30_000, maxTokens: 1_000_000 }} />
            <ContextGauge context={{ totalTokens: 850_000, maxTokens: 1_000_000 }} />
            <ContextGauge context={{ totalTokens: 980_000, maxTokens: 1_000_000 }} />
            <UsageMeter windows={fx.limits} />
          </div>
        </div>
      </Section>

      <Section id="banners" title="Banners">
        <div className="grid max-w-[780px] gap-2 overflow-hidden rounded-card border border-line">
          <Banner tone="danger">Connection lost. Reconnecting… (attempt 3) Your draft is kept.</Banner>
          <Banner tone="attention">You have used 85% of this period’s limit (resets tomorrow 05:59).</Banner>
          <Banner tone="info">The API is busy. Retrying (2/10)…</Banner>
        </div>
      </Section>

      <Section id="responsive" title="Responsive shell">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="text-sm">Scenario{' '}
            <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="min-h-8 rounded-control border border-line bg-card px-2 text-base">
              {scenarioNames.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Width" className="flex gap-1">
            {widths.map((w) => <Button key={w} variant={w === width ? 'primary' : 'secondary'} aria-pressed={w === width} onClick={() => setWidth(w)}>{w}px</Button>)}
          </div>
          <a className="text-accent underline underline-offset-2" href={`/dev/shell?state=${scenario}`} target="_blank" rel="noreferrer">Open full window</a>
        </div>
        <div tabIndex={0} role="region" aria-label="Preview window" className="overflow-x-auto rounded-card border border-line">
          <iframe title="Responsive preview" src={`/dev/shell?state=${scenario}&theme=${theme === 'system' ? '' : theme}`} style={{ width, height: 640 }} className="block max-w-none border-0" />
        </div>
      </Section>
    </main>
  );
}

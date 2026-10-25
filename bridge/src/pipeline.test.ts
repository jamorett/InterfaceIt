// The contract test: real recorded sessions → normalizer → event log → state tracker → the UI's reducer.
// If a CLI update changes a message, or either side changes the contract, this is where it shows.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionEventBody } from '@ci/shared';
import { initialView, lanesOf, recordAnswer, reduce, type SessionView } from '../../ui/src/state/reduce.ts';
import { EventLog } from './eventlog.ts';
import { createNormalizer, permissionEvent } from './normalize.ts';
import { StateTracker } from './state.ts';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const read = (name: string): Record<string, any>[] => readFileSync(dir + name + '.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));

/** play a recording the way a session does: events get numbers, the tracker adds the derived status */
function play(name: string, opts: { requests?: boolean } = {}): SessionView {
  const log = new EventLog('s', () => 1_000_000);
  const tracker = new StateTracker();
  const n = createNormalizer();
  let view = initialView('s', '/proj');
  let t = 1_000_000;
  const feed = (b: SessionEventBody) => {
    const e = log.append(b);
    (e as { ts: number }).ts = (t += 1000); // a second per event, so durations are measurable
    view = reduce(view, e, false);
    const next = tracker.apply(b);
    if (next) view = reduce(view, log.append({ type: 'session_state', state: next }), false);
  };
  for (const m of read(name)) {
    if (m.type === 'probe_permission_request') {
      if (opts.requests) feed(permissionEvent(m.tool, m.input, m.options));
      continue;
    }
    n.push(m).forEach(feed);
  }
  return view;
}

const kinds = (v: SessionView) => v.items.map((i) => i.kind);
const tools = (v: SessionView) => v.items.flatMap((i) => (i.kind === 'tool' ? [i.tool] : []));
const texts = (v: SessionView) => v.items.flatMap((i) => (i.kind === 'assistant' ? [i.text] : []));

describe('a plain turn (basic)', () => {
  const v = play('basic');
  it('ends idle with the answer shown, finished', () => {
    expect(v.state).toBe('idle');
    expect(texts(v).at(-1)).toMatch(/Steps 1 and 2 are done/); // what the model actually said in this recording
    expect(v.items.some((i) => i.kind === 'assistant' && i.streaming)).toBe(false);
  });
  it('shows Read and Bash as finished cards with what they did', () => {
    const [read, bash] = tools(v).filter((t) => t.name === 'Read' || t.name === 'Bash');
    expect(read).toMatchObject({ status: 'ok', target: expect.stringMatching(/hello\.txt$/) });
    expect(bash).toMatchObject({ status: 'ok', target: 'echo probe' });
    expect(bash!.output).toContain('probe');
    expect(bash!.elapsedSec).toBeGreaterThan(0);
  });
  it('turns finished thinking into "Thought for Ns" and keeps the rate-limit windows', () => {
    const think = v.items.find((i) => i.kind === 'thinking');
    expect(think).toMatchObject({ live: false });
    expect(v.limits.status).toBe('allowed_warning');
    expect(v.limits.sevenDay!.utilization).toBeGreaterThan(0.5);
  });
  it('knows the account is a subscription and what the session can do', () => {
    expect(v.init).toMatchObject({ authMode: 'subscription', mode: 'default' });
    expect(v.init!.tools.length).toBeGreaterThan(10);
  });
  it('never shows an unrecognised event', () => {
    expect(kinds(v)).not.toContain('unknown');
  });
});

describe('Stop (interrupt)', () => {
  const v = play('interrupt');
  it('marks the stopped turn "Stopped", not as a failure, and the session is usable again', () => {
    expect(kinds(v)).toContain('stopped');
    expect(v.items.some((i) => i.kind === 'notice' && i.level === 'danger')).toBe(false);
    expect(texts(v).at(-1)).toBe('alive');
    expect(v.state).toBe('idle');
  });
  it('shows the shell command that was stopped as a card, not as a subagent lane', () => {
    expect(lanesOf(v)).toEqual([]);
    expect(v.tasks).toMatchObject([{ type: 'local_bash', state: 'stopped' }]);
  });
});

describe('subagents', () => {
  const v = play('subagent');
  it('shows one finished lane, no leftover background work, and keeps subagent text out of the main conversation', () => {
    expect(lanesOf(v)).toHaveLength(1);
    expect(lanesOf(v)[0]).toMatchObject({ type: 'general-purpose', state: 'completed', description: 'Compute 2+2' });
    expect(v.background).toBe(0);
    expect(tools(v).map((t) => t.name)).toContain('Agent');
  });
});

describe('queued prompts run one after the other', () => {
  it('shows both answers, in order', () => {
    expect(texts(play('queue'))).toEqual(['one', 'two']);
  });
});

describe('a denied action', () => {
  it('shows the tool as failed with our message, and nothing crashes', () => {
    const v = play('denial', { requests: true });
    expect(tools(v).find((t) => t.name === 'Write')).toMatchObject({ status: 'error', output: 'Refused by the probe.' });
    const asked = v.items.find((i) => i.kind === 'permission');
    expect(asked).toMatchObject({ view: { title: expect.stringMatching(/^Write: .*denied\.txt$/) } });
  });
});

describe('a local slash command', () => {
  it('shows its output as a local-command block', () => {
    const v = play('slash');
    expect(v.items.some((i) => i.kind === 'assistant' && i.synthetic && i.text.includes('Context Usage'))).toBe(true);
  });
});

describe('permission requests', () => {
  it('an edit shows what would change; allowing for the session is remembered as such', () => {
    let v = play('edit', { requests: true });
    const req = v.items.find((i) => i.kind === 'permission')!;
    expect(req.kind === 'permission' && req.view).toMatchObject({ canRemember: true, requiresUserInteraction: false, diff: [{ kind: 'del', text: 'hello' }, { kind: 'add', text: 'goodbye' }] });
    expect(v.state).toBe('awaiting_permission'); // the fixture has no answer yet: the tracker is waiting for you
    const reqId = req.kind === 'permission' ? req.view.id : '';
    v = reduce(v, { type: 'request_resolved', reqId, outcome: 'allow', scope: 'session', sessionId: 's', seq: 9999, ts: 0 }, false);
    expect(v.items.find((i) => i.kind === 'permission')).toMatchObject({ view: { decision: 'allowed-session' } });
  });

  it('a question is answered only when every question has an answer', () => {
    let v = play('ask', { requests: true });
    const q = v.items.find((i) => i.kind === 'question')!;
    expect(v.state).toBe('awaiting_answer');
    const viewId = q.kind === 'question' ? q.view.id : '';
    const r = recordAnswer(v, viewId, ['Blue']);
    expect(r.complete).toEqual({ reqId: expect.any(String), answers: { 'Which colour do you prefer, red or blue?': 'Blue' } });
    v = reduce(r.view, { type: 'request_resolved', reqId: r.complete!.reqId, outcome: 'answered', sessionId: 's', seq: 9999, ts: 0 }, false);
    expect(v.items.find((i) => i.kind === 'question')).toMatchObject({ view: { answer: ['Blue'] } });
    expect(v.state).toBe('awaiting_answer'); // tracker not fed the resolution here; the view itself is what is asserted
  });

  it('a plan becomes a review card and approval is shown', () => {
    let v = play('plan', { requests: true });
    const plan = v.items.find((i) => i.kind === 'plan')!;
    expect(plan.kind === 'plan' && plan.view.text).toContain('notes.txt');
    v = reduce(v, { type: 'request_resolved', reqId: plan.kind === 'plan' ? plan.view.id : '', outcome: 'allow', scope: 'approve_auto', sessionId: 's', seq: 9999, ts: 0 }, false);
    expect(v.items.find((i) => i.kind === 'plan')).toMatchObject({ view: { decision: 'approved-auto' } });
  });
});

describe('reduce', () => {
  it('ignores an event it has already applied (a reconnect replays some)', () => {
    const log = new EventLog('s');
    const e = log.append({ type: 'notice', level: 'info', text: 'hi' });
    const once = reduce(initialView('s', '/p'), e, false);
    expect(reduce(once, e, false)).toBe(once);
    expect(once.items).toHaveLength(1);
  });
  it('flags items that must not animate', () => {
    const e = new EventLog('s').append({ type: 'user_message', id: 'u', text: 'x' });
    expect(reduce(initialView('s', '/p'), e, true).items[0]).toMatchObject({ instant: true });
    expect(reduce(initialView('s', '/p'), e, false).items[0]).not.toHaveProperty('instant');
  });
  it('a tool end that arrives with no start is ignored instead of crashing', () => {
    const e = new EventLog('s').append({ type: 'tool_end', id: 'ghost', result: { text: 'x', images: 0 }, isError: false });
    expect(reduce(initialView('s', '/p'), e, false).items).toEqual([]);
  });
  it('keeps nothing about a failed turn but a visible message', () => {
    const e = new EventLog('s').append({ type: 'result', ok: false, stopped: false, errorKind: 'max_turns', costUsd: 0, durationMs: 1, turns: 9, denials: 0 });
    expect(reduce(initialView('s', '/p'), e, false).items[0]).toMatchObject({ kind: 'notice', level: 'danger', text: 'The turn failed (max turns).' });
  });
  it('a session the bridge cannot continue is marked crashed so the screen can offer to resume it', () => {
    const e = new EventLog('s').append({ type: 'error', code: 'sdk_failed', message: 'Claude Code process exited with code 1', recoverable: false });
    expect(reduce(initialView('s', '/p'), e, false).crashed).toBe('Claude Code process exited with code 1');
  });
});

describe('history', () => {
  it('a stored conversation becomes the same cards as a live one', () => {
    const history = JSON.parse(readFileSync(dir + 'history.json', 'utf8')).getSessionMessages as Record<string, any>[];
    const n = createNormalizer('history');
    const log = new EventLog('h');
    let v = initialView('h', '/p');
    for (const b of history.flatMap((m) => n.push(m))) v = reduce(v, log.append(b, { replayed: true }), true);
    expect(v.items[0]).toMatchObject({ kind: 'user', text: expect.stringMatching(/^Do these in order/), instant: true });
    expect(tools(v).length).toBeGreaterThan(0);
    expect(tools(v).every((t) => t.instant)).toBe(true);
  });
});

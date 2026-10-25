import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionEventBody, SessionState } from '@ci/shared';
import { createNormalizer } from './normalize.ts';
import { StateTracker } from './state.ts';

/** every distinct state the tracker passes through, in order */
function states(events: SessionEventBody[]): SessionState[] {
  const t = new StateTracker();
  const seen: SessionState[] = [];
  for (const e of events) {
    const s = t.apply(e);
    if (s) seen.push(s);
  }
  return seen;
}
const sdk = (state: 'idle' | 'running' | 'requires_action'): SessionEventBody => ({ type: 'sdk_state', state });
const result = (ok: boolean, stopped = false): SessionEventBody => ({ type: 'result', ok, stopped, costUsd: 0, durationMs: 1, turns: 1, denials: 0 });

describe('StateTracker', () => {
  it('idle → running → idle for a plain turn', () => {
    expect(states([sdk('running'), result(true), sdk('idle')])).toEqual(['running', 'idle']);
  });

  it('a result does NOT end the session: a background agent keeps it running until the SDK says idle', () => {
    expect(states([sdk('running'), result(true), { type: 'sdk_state', state: 'running' }, result(true), sdk('idle')])).toEqual(['running', 'idle']);
    const t = new StateTracker();
    t.apply(sdk('running'));
    t.apply(result(true));
    expect(t.state).toBe('running');
    expect(t.busy).toBe(true);
  });

  it('waits for you while a permission or plan is pending, and for an answer to a question', () => {
    const req: SessionEventBody = { type: 'permission_request', reqId: 'r', tool: 'Edit', toolUseId: 't', input: {}, requiresUserInteraction: false, canRemember: true };
    expect(states([sdk('running'), req, { type: 'request_resolved', reqId: 'r', outcome: 'allow' }])).toEqual(['running', 'awaiting_permission', 'running']);
    expect(states([sdk('running'), { type: 'question', reqId: 'q', toolUseId: 't', questions: [] }])).toEqual(['running', 'awaiting_answer']);
    expect(states([sdk('running'), { type: 'plan', reqId: 'p', toolUseId: 't', markdown: '' }])).toEqual(['running', 'awaiting_permission']);
  });

  it('two requests at once: stays "needs you" until both are answered', () => {
    const a: SessionEventBody = { type: 'permission_request', reqId: 'a', tool: 'Edit', toolUseId: 'x', input: {}, requiresUserInteraction: false, canRemember: false };
    const t = new StateTracker();
    t.apply(sdk('running'));
    t.apply(a);
    t.apply({ ...a, reqId: 'b' });
    t.apply({ type: 'request_resolved', reqId: 'a', outcome: 'allow' });
    expect(t.state).toBe('awaiting_permission');
    t.apply({ type: 'request_resolved', reqId: 'b', outcome: 'deny' });
    expect(t.state).toBe('running');
  });

  it('shows compacting, retrying and rate limits, and recovers from each', () => {
    expect(states([sdk('running'), { type: 'status', compacting: true }, { type: 'status', compacting: false }])).toEqual(['running', 'compacting', 'running']);
    expect(states([sdk('running'), { type: 'retrying', attempt: 1, maxRetries: 10, delayMs: 500, status: 529, error: 'overloaded' }, { type: 'block_start', blockId: 'b', kind: 'text' }])).toEqual(['running', 'retrying', 'running']);
    expect(states([sdk('running'), { type: 'rate_limit', status: 'rejected' }, sdk('idle'), { type: 'rate_limit', status: 'allowed' }])).toEqual(['running', 'rate_limited', 'idle']);
  });

  it('a failed turn is an error until the next turn starts; a Stop is not', () => {
    expect(states([sdk('running'), result(false), sdk('idle'), sdk('running')])).toEqual(['running', 'error', 'running']);
    expect(states([sdk('running'), result(false, true), sdk('idle')])).toEqual(['running', 'idle']);
  });

  it('ended wins over everything', () => {
    expect(states([sdk('running'), { type: 'session_ended', reason: 'closed' }, sdk('idle')])).toEqual(['running', 'ended']);
  });

  it('follows real recorded sessions', () => {
    const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
    const run = (name: string) => {
      const n = createNormalizer();
      return states(readFileSync(dir + name + '.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => !String(m.type).startsWith('probe_')).flatMap((m) => n.push(m)));
    };
    expect(run('basic')).toEqual(['running', 'idle']);
    expect(run('queue')).toEqual(['running', 'idle']); // the second turn does not flicker through idle
    // the SDK's own requires_action covers the pending Bash permission; Stop ends in idle (not error); the next prompt runs
    expect(run('interrupt')).toEqual(['running', 'awaiting_permission', 'running', 'idle', 'running', 'idle']);
  });
});

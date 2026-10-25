import { describe, expect, it } from 'vitest';
import type { Effort, PermissionMode, SessionEvent, SessionEventBody } from '@ci/shared';
import { SessionCore, type Decision } from './core.ts';

/** A session whose "Claude" is the test: it records what was delivered and lets the test feed events and answer requests. */
class TestSession extends SessionCore {
  delivered: string[] = [];
  stops = 0;
  protected deliver(_id: string, text: string) { this.delivered.push(text); }
  protected async stop() { this.stops++; }
  async setMode(_m: PermissionMode) {}
  async setModel(_m: string) {}
  async setEffort(_e: Effort) {}
  close() {}
  feed(...b: SessionEventBody[]) { this.ingest(b); }
  permission(tool: string, input: Record<string, unknown>, suggestions: unknown = []): Promise<Decision> {
    return this.request({ type: 'permission_request', reqId: 'r1', tool, toolUseId: 't1', input, requiresUserInteraction: false, canRemember: true }, tool, input, suggestions);
  }
  question(input: Record<string, unknown>): Promise<Decision> {
    return this.request({ type: 'question', reqId: 'q1', toolUseId: 't2', questions: [] }, 'AskUserQuestion', input, []);
  }
  plan(): Promise<Decision> {
    return this.request({ type: 'plan', reqId: 'p1', toolUseId: 't3', markdown: '# plan' }, 'ExitPlanMode', { plan: '# plan' }, []);
  }
  types() { return this.log.after(0).map((e) => e.type); }
  state() { return this.tracker.state; }
}

const running = (s: TestSession) => s.feed({ type: 'sdk_state', state: 'running' });
const idle = (s: TestSession) => s.feed({ type: 'sdk_state', state: 'idle' });

describe('prompts and the queue', () => {
  it('sends the first prompt at once and echoes it', () => {
    const s = new TestSession('s', '/p');
    s.prompt('hello');
    expect(s.delivered).toEqual(['hello']);
    expect(s.log.after(0).find((e) => e.type === 'user_message')).toMatchObject({ text: 'hello' });
  });

  it('queues prompts while a turn runs (and in the moment before the SDK says "running"), then sends them in order when idle', () => {
    const s = new TestSession('s', '/p');
    s.prompt('one');
    s.prompt('two'); // "running" has not arrived yet: still has to wait
    expect(s.delivered).toEqual(['one']);
    running(s);
    s.prompt('three');
    expect(s.types().filter((t) => t === 'prompt_queued')).toHaveLength(2);
    idle(s);
    expect(s.delivered).toEqual(['one', 'two']);
    running(s);
    idle(s);
    expect(s.delivered).toEqual(['one', 'two', 'three']);
  });

  it('a result alone does not release the queue (a background agent may start another turn)', () => {
    const s = new TestSession('s', '/p');
    s.prompt('one');
    running(s);
    s.prompt('two');
    s.feed({ type: 'result', ok: true, stopped: false, costUsd: 0, durationMs: 1, turns: 1, denials: 0 });
    expect(s.delivered).toEqual(['one']);
  });

  it('lets the user remove a queued prompt before it is sent', () => {
    const s = new TestSession('s', '/p');
    s.prompt('one');
    running(s);
    s.prompt('drop me');
    const queued = s.log.after(0).find((e) => e.type === 'prompt_queued') as Extract<SessionEvent, { type: 'prompt_queued' }>;
    s.unqueue(queued.id);
    s.unqueue('does-not-exist'); // harmless
    idle(s);
    expect(s.delivered).toEqual(['one']);
    expect(s.log.after(0).find((e) => e.type === 'prompt_unqueued')).toMatchObject({ reason: 'removed' });
  });

  it('never leaves the queue stuck if the SDK fails before saying "running"', () => {
    const s = new TestSession('s', '/p');
    s.prompt('one');
    s.feed({ type: 'error', code: 'sdk_failed', message: 'x', recoverable: false });
    s.prompt('two');
    expect(s.delivered).toEqual(['one', 'two']);
  });

  it('titles the session after its first prompt', () => {
    const s = new TestSession('s', '/p');
    expect(s.info().title).toBe('New session');
    s.prompt('Fix the failing test');
    expect(s.info().title).toBe('Fix the failing test');
  });
});

describe('Stop', () => {
  it('cancels what is waiting, drops the queue, and interrupts', async () => {
    const s = new TestSession('s', '/p');
    s.prompt('one');
    running(s);
    const pending = s.permission('Bash', { command: 'sleep' });
    s.prompt('later');
    await s.interrupt();
    expect(await pending).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(s.stops).toBe(1);
    const unq = s.log.after(0).filter((e) => e.type === 'prompt_unqueued');
    expect(unq).toMatchObject([{ reason: 'stopped' }]);
    expect(s.log.after(0).find((e) => e.type === 'request_resolved')).toMatchObject({ outcome: 'cancelled' });
    idle(s);
    expect(s.delivered).toEqual(['one']); // the dropped prompt never runs
  });
});

describe('permission replies', () => {
  it('allow once keeps the input and adds no rule', async () => {
    const s = new TestSession('s', '/p');
    const d = s.permission('Edit', { file_path: 'a.txt', old_string: 'x' });
    s.permissionReply('r1', 'allow');
    expect(await d).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.txt', old_string: 'x' }, updatedPermissions: undefined });
  });

  it('allow for a place re-targets the CLI\'s own rule', async () => {
    const s = new TestSession('s', '/p');
    const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
    const d = s.permission('Bash', { command: 'npm test' }, [rule]);
    s.permissionReply('r1', 'allow', 'user');
    expect(await d).toMatchObject({ behavior: 'allow', updatedPermissions: [{ ...rule, destination: 'userSettings' }] });
  });

  it('merges only the changed fields into the input (an edited command)', async () => {
    const s = new TestSession('s', '/p');
    const d = s.permission('Bash', { command: 'rm -rf build', description: 'clean', timeout: 5000 });
    s.permissionReply('r1', 'allow', 'once', undefined, { command: 'rm -rf build/cache' });
    expect(await d).toMatchObject({ updatedInput: { command: 'rm -rf build/cache', description: 'clean', timeout: 5000 } });
  });

  it('deny tells Claude why', async () => {
    const s = new TestSession('s', '/p');
    const d = s.permission('Write', { file_path: 'a' });
    s.permissionReply('r1', 'deny', undefined, 'not here');
    expect(await d).toEqual({ behavior: 'deny', message: 'The user denied this action: not here' });
    expect(s.log.after(0).find((e) => e.type === 'request_resolved')).toMatchObject({ outcome: 'deny', reason: 'not here' });
  });

  it('ignores a second answer, an unknown request, and the wrong kind of answer', async () => {
    const s = new TestSession('s', '/p');
    const d = s.permission('Edit', {});
    s.permissionReply('r1', 'allow');
    s.permissionReply('r1', 'deny'); // another window answered second
    s.permissionReply('nope', 'allow');
    s.answer('r1', { q: 'a' });
    await d;
    expect(s.types().filter((t) => t === 'request_resolved')).toHaveLength(1);
  });
});

describe('questions and plans', () => {
  it('a question is answered through updatedInput.answers', async () => {
    const s = new TestSession('s', '/p');
    const d = s.question({ questions: [{ question: 'Colour?' }] });
    s.answer('q1', { 'Colour?': 'Blue' });
    expect(await d).toEqual({ behavior: 'allow', updatedInput: { questions: [{ question: 'Colour?' }], answers: { 'Colour?': 'Blue' } } });
    expect(s.log.after(0).find((e) => e.type === 'request_resolved')).toMatchObject({ outcome: 'answered' });
  });

  it('approving a plan with auto-accept switches the session to accept-edits; reviewing each edit does not', async () => {
    const a = new TestSession('s', '/p');
    const da = a.plan();
    a.planReply('p1', 'approve_auto');
    expect(await da).toMatchObject({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] });
    const b = new TestSession('s', '/p');
    const db = b.plan();
    b.planReply('p1', 'approve_manual');
    expect(await db).toMatchObject({ behavior: 'allow', updatedPermissions: undefined });
  });

  it('rejecting a plan carries the feedback', async () => {
    const s = new TestSession('s', '/p');
    const d = s.plan();
    s.planReply('p1', 'reject', 'skip step 3');
    expect(await d).toEqual({ behavior: 'deny', message: 'The user rejected the plan. Their feedback: skip step 3' });
  });
});

describe('state and history', () => {
  it('announces each status change once', () => {
    const s = new TestSession('s', '/p');
    running(s);
    running(s);
    idle(s);
    expect(s.log.after(0).filter((e) => e.type === 'session_state').map((e) => (e as { state: string }).state)).toEqual(['running', 'idle']);
  });

  it('history is stored flagged as replayed and does not change the live status', () => {
    const s = new TestSession('s', '/p');
    s.seedHistory([{ type: 'user_message', id: 'u', text: 'old question' }, { type: 'sdk_state', state: 'running' }]);
    expect(s.log.after(0).every((e) => e.replayed)).toBe(true);
    expect(s.state()).toBe('idle');
    expect(s.info().title).toBe('old question');
  });

  it('tells every listener and stops telling one that unsubscribed', () => {
    const s = new TestSession('s', '/p');
    const seen: string[] = [];
    const off = s.subscribe((e) => seen.push(e.type));
    s.feed({ type: 'commands_changed' });
    off();
    s.feed({ type: 'commands_changed' });
    expect(seen).toEqual(['commands_changed']);
  });
});

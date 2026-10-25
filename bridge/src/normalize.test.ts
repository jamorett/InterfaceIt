import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionEventBody } from '@ci/shared';
import { commandsEvent, createNormalizer, permissionEvent, permissionUpdates, toResult, usageEvent } from './normalize.ts';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const lines = (name: string): Record<string, any>[] => readFileSync(dir + name + '.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sdkMessages = (name: string) => lines(name).filter((m) => !String(m.type).startsWith('probe_'));
const notes = (name: string) => JSON.parse(readFileSync(dir + name + '.notes.json', 'utf8'));

function run(name: string): SessionEventBody[] {
  const n = createNormalizer('live');
  return sdkMessages(name).flatMap((m) => n.push(m));
}
const of = <T extends SessionEventBody['type']>(events: SessionEventBody[], type: T) => events.filter((e): e is Extract<SessionEventBody, { type: T }> => e.type === type);

/** Rebuilds the visible text per block the way the UI store will. */
function blocks(events: SessionEventBody[]) {
  const text = new Map<string, string>();
  const kind = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'block_start') { kind.set(e.blockId, e.kind); text.set(e.blockId, ''); }
    else if (e.type === 'text_delta' || e.type === 'thinking_delta') text.set(e.blockId, (text.get(e.blockId) ?? '') + e.text);
  }
  return { text, kind };
}

const fixtureNames = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace('.jsonl', ''));

describe('every recorded real session', () => {
  it.each(fixtureNames)('%s normalizes without a single unknown event', (name) => {
    expect(of(run(name), 'unknown')).toEqual([]);
  });

  it.each(fixtureNames)('%s: every block that starts also ends, and its text is never duplicated', (name) => {
    const ev = run(name);
    const started = of(ev, 'block_start').map((e) => e.blockId);
    const ended = of(ev, 'block_end').map((e) => e.blockId);
    expect(new Set(started).size).toBe(started.length);
    expect(ended.sort()).toEqual([...started].sort());
    // the complete `assistant` message that follows the stream must not add the text a second time
    const finals = sdkMessages(name).filter((m) => m.type === 'assistant' && !m.parent_tool_use_id).flatMap((m) => m.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text as string));
    const shown = [...blocks(ev).text.entries()].filter(([id]) => blocks(ev).kind.get(id) === 'text').map(([, t]) => t);
    for (const f of finals) expect(shown.filter((t) => t === f).length).toBeGreaterThanOrEqual(1);
    expect(shown.join('').length).toBeLessThan(finals.join('').length * 3 + 5000);
  });
});

describe('session_init and status', () => {
  const ev = run('basic');
  it('reads the account mode from apiKeySource, not from anything personal', () => {
    const init = of(ev, 'session_init')[0]!;
    expect(init.authMode).toBe('subscription');
    expect(init.tools.length).toBe(30);
    expect(init.mode).toBe('default');
    expect(init.version).toMatch(/^2\./);
    expect(JSON.stringify(init)).not.toMatch(/@/);
  });
  it('reports the SDK session state', () => {
    expect(of(ev, 'sdk_state').map((e) => e.state)).toEqual(['running', 'idle']);
  });
  it('init repeats per turn (queue scenario has two) and the second may know more tools', () => {
    expect(of(run('queue'), 'session_init')).toHaveLength(2);
  });
});

describe('tools', () => {
  it('basic: Read and Bash get a card start, the final input and an end', () => {
    const ev = run('basic');
    const starts = of(ev, 'tool_start');
    expect(starts.map((s) => s.name)).toEqual(expect.arrayContaining(['Read', 'Bash']));
    for (const s of starts) {
      expect(of(ev, 'tool_input').some((i) => i.id === s.id)).toBe(true);
      expect(of(ev, 'tool_end').some((e) => e.id === s.id)).toBe(true);
    }
    const bash = starts.find((s) => s.name === 'Bash')!;
    expect(of(ev, 'tool_input').find((i) => i.id === bash.id)!.input).toMatchObject({ command: 'echo probe' });
    expect(of(ev, 'tool_end').find((e) => e.id === bash.id)!.result.text).toContain('probe');
  });

  it('denial: our deny message comes back as an error result and is counted', () => {
    const ev = run('denial');
    expect(of(ev, 'tool_end').find((e) => e.isError)!.result.text).toBe('Refused by the probe.');
    expect(of(ev, 'result')[0]!.denials).toBe(1);
  });

  it('turns tool_result content of any shape into text', () => {
    expect(toResult('plain')).toEqual({ text: 'plain', images: 0 });
    expect(toResult([{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'tool_reference', tool_name: 'CronList' }])).toEqual({ text: 'a\n[tool: CronList]', images: 1 });
    expect(toResult(undefined)).toEqual({ text: '', images: 0 });
  });
});

describe('results', () => {
  it('a normal turn is ok', () => {
    expect(of(run('basic'), 'result')[0]).toMatchObject({ ok: true, stopped: false, terminalReason: 'completed' });
  });
  it('Stop is "stopped", not an error, and carries no diagnostic text', () => {
    const [stopped, next] = of(run('interrupt'), 'result');
    expect(stopped).toMatchObject({ ok: false, stopped: true, terminalReason: 'aborted_tools' });
    expect(stopped!.message).toBeUndefined();
    expect(next).toMatchObject({ ok: true });
  });
  it('a result is not the end of a session: a queued second turn gives a second result', () => {
    expect(of(run('queue'), 'result')).toHaveLength(2);
  });
});

describe('subagents and tasks', () => {
  const ev = run('subagent');
  it('describes the agent from start to end', () => {
    const states = of(ev, 'task').filter((t) => t.state).map((t) => t.state);
    expect(states[0]).toBe('running');
    expect(states).toContain('completed');
    expect(of(ev, 'task')[0]).toMatchObject({ taskType: 'local_agent', subagentType: 'general-purpose', background: true });
  });
  it('forwards the subagent text under the Agent tool call', () => {
    const agentCall = of(ev, 'tool_start').find((t) => t.name === 'Agent')!;
    expect(of(ev, 'block_start').some((b) => b.parentId === agentCall.id)).toBe(true);
  });
  it('replaces the background task list each time', () => {
    const lists = of(ev, 'background_tasks').map((e) => e.tasks.length);
    expect(lists[0]).toBe(1);
    expect(lists.at(-1)).toBe(0);
  });
  it('a stopped shell command is reported as stopped', () => {
    const tasks = of(run('interrupt'), 'task');
    expect(tasks[0]).toMatchObject({ taskType: 'local_bash', state: 'running' });
    expect(tasks.some((t) => t.state === 'stopped')).toBe(true);
  });
});

describe('other messages', () => {
  it('rate limits carry both windows as fractions and epoch seconds', () => {
    const r = of(run('basic'), 'rate_limit')[0]!;
    expect(r.status).toBe('allowed_warning');
    expect(r.fiveHour!.utilization).toBeLessThan(1);
    expect(r.sevenDay!.resetsAt).toBeGreaterThan(1.7e9);
  });
  it('a local /context answer is a synthetic text block', () => {
    const ev = run('slash');
    const b = of(ev, 'block_start').find((x) => x.synthetic)!;
    expect(blocks(ev).text.get(b.blockId)).toContain('Context Usage');
  });
  it('live thinking is reported as an estimate, not text', () => {
    const ev = run('plan');
    expect(of(ev, 'thinking_progress').length).toBeGreaterThan(0);
  });
});

describe('history (getSessionMessages)', () => {
  const history = JSON.parse(readFileSync(dir + 'history.json', 'utf8')).getSessionMessages as Record<string, any>[];
  const n = createNormalizer('history');
  const ev = history.flatMap((m) => n.push(m));
  it('turns the stored conversation into the same events as a live one', () => {
    expect(of(ev, 'user_message')[0]!.text).toMatch(/^Do these in order/);
    expect(of(ev, 'tool_start').length).toBeGreaterThan(0);
    expect(of(ev, 'tool_end').length).toBeGreaterThan(0);
    expect(of(ev, 'unknown')).toEqual([]);
  });
  it('contains no stream events, so nothing in it can animate', () => {
    expect(ev.every((e) => e.type !== 'thinking_progress' && e.type !== 'sdk_state')).toBe(true);
  });
});

describe('hostile input never throws', () => {
  const n = createNormalizer();
  it.each<[string, unknown]>([
    ['null', null], ['a string', 'text'], ['a number', 42], ['unknown type', { type: 'brand_new' }],
    ['assistant without message', { type: 'assistant' }], ['assistant with a numeric message', { type: 'assistant', message: 5 }],
    ['delta before any start', { type: 'stream_event', event: { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'x' } } }],
    ['stream_event without event', { type: 'stream_event' }],
    ['new system subtype', { type: 'system', subtype: 'invented_next_year' }],
    ['result with wrong types', { type: 'result', subtype: 7, total_cost_usd: 'free', permission_denials: 'none' }],
    ['tool_result with nonsense', { type: 'user', message: { content: [{ type: 'tool_result', content: { weird: true } }] } }],
  ])('%s', (_name, input) => {
    expect(() => n.push(input)).not.toThrow();
  });
  it('reports the unrecognised ones as unknown so they stay visible in the debug view', () => {
    expect(n.push({ type: 'brand_new' })[0]).toMatchObject({ type: 'unknown' });
    expect(n.push({ type: 'system', subtype: 'invented_next_year' })[0]).toMatchObject({ type: 'unknown' });
  });
});

describe('permission requests', () => {
  const reqs = (name: string) => lines(name).filter((m) => m.type === 'probe_permission_request');

  it('an edit can be remembered, shows what it is, and keeps the raw input for the diff', () => {
    const r = reqs('edit')[0]!;
    const e = permissionEvent(r.tool, r.input, r.options);
    expect(e).toMatchObject({ type: 'permission_request', tool: 'Edit', canRemember: true, requiresUserInteraction: false });
    expect((e as any).input.old_string).toBe('hello');
  });
  it('AskUserQuestion becomes a question', () => {
    const r = reqs('ask')[0]!;
    const e = permissionEvent(r.tool, r.input, r.options);
    expect(e).toMatchObject({ type: 'question' });
    expect((e as any).questions[0].options.map((o: any) => o.label)).toEqual(['Red', 'Blue']);
  });
  it('ExitPlanMode becomes a plan and can never be remembered', () => {
    const r = reqs('plan').find((x) => x.tool === 'ExitPlanMode')!;
    const e = permissionEvent(r.tool, r.input, r.options);
    expect(e).toMatchObject({ type: 'plan' });
    expect((e as any).markdown).toContain('notes.txt');
  });
  it('Bash gets the CLI reason text', () => {
    const r = reqs('interrupt')[0]!;
    expect(permissionEvent(r.tool, r.input, r.options)).toMatchObject({ reason: 'This command requires approval', canRemember: true });
  });
  it('requiresUserInteraction hides "allow for…"', () => {
    expect(permissionEvent('X', {}, { requestId: 'r', toolUseID: 't', requiresUserInteraction: true, suggestions: [{}] })).toMatchObject({ canRemember: false, requiresUserInteraction: true });
  });
});

describe('permissionUpdates', () => {
  const bashRule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
  const editMode = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];
  it('re-targets the CLI\'s own rule to the chosen place', () => {
    expect(permissionUpdates('Bash', bashRule, 'user')).toEqual([{ ...bashRule[0], destination: 'userSettings' }]);
    expect(permissionUpdates('Bash', bashRule, 'project')[0]).toMatchObject({ destination: 'projectSettings' });
    expect(permissionUpdates('Bash', bashRule, 'session')[0]).toMatchObject({ destination: 'session' });
  });
  it('keeps the CLI\'s mode switch for "this session"', () => {
    expect(permissionUpdates('Edit', editMode, 'session')).toEqual(editMode);
  });
  it('otherwise allows the whole tool at the chosen place', () => {
    expect(permissionUpdates('Edit', editMode, 'local')).toEqual([{ type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'localSettings' }]);
  });
});

describe('usageEvent', () => {
  it('reads the real getContextUsage answer', () => {
    const e = usageEvent(notes('basic').methods.getContextUsage_summary)!;
    expect(e).toMatchObject({ type: 'usage', maxTokens: 1_000_000 });
    expect(e.type === 'usage' && e.categories.length).toBeGreaterThan(3);
  });
  it('ignores answers it cannot read', () => {
    expect(usageEvent(null)).toBeUndefined();
    expect(usageEvent({ totalTokens: 5 })).toBeUndefined();
  });
});

describe('commandsEvent', () => {
  it('drops the leading slash and keeps description and hint', () => {
    expect(commandsEvent([{ name: '/review', description: 'Review', argumentHint: '[pr]' }, { name: 'compact' }, { name: '' }])).toEqual({
      type: 'commands',
      commands: [{ name: 'review', description: 'Review', hint: '[pr]' }, { name: 'compact', description: undefined, hint: undefined }],
    });
  });
  it('says nothing for an empty or odd answer', () => {
    expect(commandsEvent([])).toBeUndefined();
    expect(commandsEvent('nope')).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@ci/shared';
import { settingsFromLog } from '../sessions.ts';
import { NvidiaClient } from './client.ts';
import { Hooks } from './hooks.ts';
import { McpManager } from './mcp.ts';
import { NvidiaSession } from './session.ts';

const tmp = process.cwd();
const types = (s: NvidiaSession) => s.log.after(0).map((e: SessionEvent) => e.type);
const lastInit = (s: NvidiaSession) => [...s.log.after(0)].reverse().find((e) => e.type === 'session_init') as Extract<SessionEvent, { type: 'session_init' }>;
const tick = () => new Promise((r) => setTimeout(r, 20));

// the tests must not run the developer's own hooks or start their MCP servers
beforeEach(() => {
  vi.spyOn(Hooks.prototype, 'any', 'get').mockReturnValue(false);
  vi.spyOn(McpManager.prototype, 'start').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('nvidia session settings reach the header', () => {
  it('setModel re-sends session_init so the model box shows the choice', async () => {
    const s = new NvidiaSession({ cwd: tmp });
    await s.setModel('nvidia/nemotron-3.5-lightning-30b-a3b');
    expect(lastInit(s).model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
  });
  it('setMode sends status and init; bypass stays off without the opt-in', async () => {
    const s = new NvidiaSession({ cwd: tmp });
    await s.setMode('auto');
    expect(lastInit(s).mode).toBe('auto');
    await s.setMode('bypassPermissions');
    expect(lastInit(s).mode).toBe('auto');
  });
  it('setEffort reports the new level so the effort selector shows it', async () => {
    const s = new NvidiaSession({ cwd: tmp });
    await s.setEffort('high');
    expect(lastInit(s).effort).toBe('high');
    expect(s.log.after(0).some((e) => e.type === 'status' && e.effort === 'high')).toBe(true);
  });
  it('a handoff keeps the mode and folders found in the log', async () => {
    const s = new NvidiaSession({ cwd: tmp, mode: 'acceptEdits', addDirs: ['/x'] });
    await s.setMode('plan');
    expect(settingsFromLog(s.log.after(0))).toEqual({ mode: 'plan', addDirs: ['/x'] });
  });
});

describe('nvidia turn loop', () => {
  it('Stop is not reported as an error and leaves no unanswered tool call', async () => {
    let release!: () => void;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      await new Promise<void>((res, rej) => {
        release = res;
        req.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
      return { text: '', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp });
    s.prompt('hi');
    await tick();
    await s.interrupt();
    await tick();
    expect(types(s)).not.toContain('error');
    expect(types(s).filter((t) => t === 'result')).toHaveLength(1);
    release();
  });

  it('invalid JSON arguments go back to the model instead of running', async () => {
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command": "ec' } }] }
        : { text: 'done', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'bypassPermissions' });
    s.prompt('go');
    await tick();
    await tick();
    const end = s.log.after(0).find((e) => e.type === 'tool_end') as Extract<SessionEvent, { type: 'tool_end' }>;
    expect(end.isError).toBe(true);
    expect(end.result.text).toContain('not valid JSON');
  });

  it('a long conversation is summarised before the next call and the usage is reported', async () => {
    const seen: number[] = [];
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      const isSummary = req.max_tokens === 2000;
      seen.push(req.messages.length);
      return isSummary
        ? { text: 'SUMMARY', reasoning: '', toolCalls: [] }
        : { text: 'ok', reasoning: '', toolCalls: [], usage: { promptTokens: 1000, completionTokens: 5 } };
    });
    const s = new NvidiaSession({ cwd: tmp, model: 'test/unlisted-model' }); // a model not in the list gets the 32k default window
    const filler = 'y'.repeat(20_000); // ~5k tokens per user message
    for (let i = 0; i < 6; i++) {
      s.prompt(`${i} ${filler}`);
      await tick();
    }
    const kinds = types(s);
    expect(kinds).toContain('usage');
    expect(s.log.after(0).some((e) => e.type === 'notice' && e.text.includes('summarised'))).toBe(true);
    expect(s.log.after(0).some((e) => e.type === 'status' && e.compacting)).toBe(true);
  });

  it('parallel subagents answer in the order asked, and a read-only one cannot write', async () => {
    const sub = (id: string, prompt: string) => ({ id, type: 'function' as const, function: { name: 'invoke_subagent', arguments: JSON.stringify({ role: 'R', description: 'd', prompt, read_only: true }) } });
    let mainCalls = 0;
    let mainTail: string[] = [];
    let slowSawWriteRefusal = '';
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      const first = String(req.messages[0]?.content);
      if (!first.includes('delegated task within workspace')) {
        mainCalls++;
        if (mainCalls === 1) return { text: '', reasoning: '', toolCalls: [sub('a', 'SLOW'), sub('b', 'FAST')] };
        mainTail = req.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id!);
        return { text: 'done', reasoning: '', toolCalls: [] };
      }
      const task = String(req.messages[1]?.content);
      const last = req.messages.at(-1)!;
      if (task === 'SLOW') {
        if (last.role === 'tool') { slowSawWriteRefusal = String(last.content); return { text: 'slow done', reasoning: '', toolCalls: [] }; }
        await new Promise((r) => setTimeout(r, 40));
        return { text: '', reasoning: '', toolCalls: [{ id: 'w', type: 'function', function: { name: 'write_file', arguments: '{"path":"zz.txt","content":"x"}' } }] };
      }
      return { text: 'fast done', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'bypassPermissions' });
    process.env.CLAUDEINTERFACE_ALLOW_BYPASS = '1';
    await s.setMode('bypassPermissions');
    s.prompt('go');
    await new Promise((r) => setTimeout(r, 200));
    delete process.env.CLAUDEINTERFACE_ALLOW_BYPASS;
    expect(mainTail).toEqual(['a', 'b']);
    expect(slowSawWriteRefusal).toContain('not available to subagents');
  });

  it('ask_user_question shows the card and hands the answer back to the model', async () => {
    let calls = 0;
    let toolText = '';
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      calls++;
      if (calls === 2) toolText = String(req.messages.at(-1)?.content);
      const args = JSON.stringify({ questions: [{ question: 'Which DB?', header: 'DB', options: [{ label: 'SQLite', description: 'file' }, { label: 'Postgres', description: 'server' }] }] });
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 'q1', type: 'function', function: { name: 'ask_user_question', arguments: args } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp });
    s.prompt('pick');
    await tick();
    const q = s.log.after(0).find((e) => e.type === 'question') as Extract<SessionEvent, { type: 'question' }>;
    expect(q.questions[0]?.options).toHaveLength(2);
    s.answer(q.reqId, { 'Which DB?': 'SQLite' });
    await tick();
    expect(toolText).toBe('Which DB? → SQLite');
  });

  it('a background command is started, polled and stopped', async () => {
    process.env.CLAUDEINTERFACE_ALLOW_BYPASS = '1';
    const results: string[] = [];
    let step = 0;
    let id = '';
    const call = (name: string, args: object) => ({ text: '', reasoning: '', toolCalls: [{ id: `c${step}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      const last = req.messages.at(-1);
      if (last?.role === 'tool') {
        results.push(String(last.content));
        id = /bg_\w+/.exec(String(last.content))?.[0] ?? id;
      }
      step++;
      if (step === 1) return call('bash', { command: 'node -e "console.log(123);setTimeout(()=>{},60000)"', run_in_background: true });
      if (step === 2) { await new Promise((r) => setTimeout(r, 600)); return call('bash_output', { id }); }
      if (step === 3) return call('bash_kill', { id });
      return { text: 'done', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'bypassPermissions' });
    s.prompt('serve');
    await new Promise((r) => setTimeout(r, 1500));
    delete process.env.CLAUDEINTERFACE_ALLOW_BYPASS;
    expect(results[0]).toContain('Started in the background as bg_');
    expect(results[1]).toContain('123');
    expect(results[1]).toContain('still running');
    expect(results[2]).toBe('Stopped.');
    s.close();
  }, 15_000);

  it('TodoWrite is accepted so the task strip can draw it', async () => {
    let step = 0;
    let answer = '';
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      if (req.messages.at(-1)?.role === 'tool') answer = String(req.messages.at(-1)!.content);
      step++;
      return step === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 't', type: 'function', function: { name: 'TodoWrite', arguments: JSON.stringify({ todos: [{ content: 'Run tests', activeForm: 'Running tests', status: 'in_progress' }] }) } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'plan' }); // allowed even in plan mode
    s.prompt('plan it');
    await tick();
    await tick();
    expect(answer).toBe('Task list updated.');
    expect(types(s)).not.toContain('permission_request');
  });

  it('plan mode denies a write without asking', async () => {
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"zz.txt","content":"x"}' } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'plan' });
    s.prompt('write');
    await tick();
    await tick();
    expect(types(s)).not.toContain('permission_request');
    const end = s.log.after(0).find((e) => e.type === 'tool_end') as Extract<SessionEvent, { type: 'tool_end' }>;
    expect(end.result.text).toContain('Plan mode is read-only');
  });
});

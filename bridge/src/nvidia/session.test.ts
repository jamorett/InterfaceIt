import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@ci/shared';
import { diffFor } from '../../../ui/src/state/describe.ts';
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
    // the same divider Claude's compaction draws, with the size before and after
    const compact = s.log.after(0).find((e) => e.type === 'compact') as Extract<SessionEvent, { type: 'compact' }>;
    expect(compact.preTokens).toBeGreaterThan(compact.postTokens ?? Infinity);
    expect(s.log.after(0).some((e) => e.type === 'status' && e.compacting)).toBe(true);
  });

  describe('subagents do real work and can be watched', () => {
    const isSub = (req: { messages: { content?: unknown }[] }) => String(req.messages[0]?.content).includes('working as a subagent');
    const subCall = (id: string, prompt: string, files?: string[]) => ({ id, type: 'function' as const, function: { name: 'invoke_subagent', arguments: JSON.stringify({ role: `Builder ${id}`, description: `task ${prompt}`, prompt, ...(files && { files, check: 'node t.js' }) }) } });
    const writeCall = (id: string, path: string) => ({ id, type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path, content: `from ${path}` }) } });
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ci-sub-')); process.env.CLAUDEINTERFACE_ALLOW_BYPASS = '1'; });
    afterEach(() => { delete process.env.CLAUDEINTERFACE_ALLOW_BYPASS; rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

    it('two subagents write their own files in parallel, answers come back in order with the real file list', async () => {
      let mainCalls = 0;
      let mainTail: string[] = [];
      let reports = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req, cb) => {
        if (!isSub(req)) {
          mainCalls++;
          if (mainCalls === 1) return { text: '', reasoning: '', toolCalls: [subCall('a', 'SLOW', ['slow.txt']), subCall('b', 'FAST', ['fast.txt'])] };
          mainTail = req.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id!);
          reports = req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
          return { text: 'done', reasoning: '', toolCalls: [] };
        }
        const task = String(req.messages[1]?.content);
        const wrote = req.messages.at(-1)?.role === 'tool';
        if (wrote) return { text: `${task} finished`, reasoning: '', toolCalls: [], usage: { promptTokens: 100, completionTokens: 20 } };
        if (task === 'SLOW') await new Promise((r) => setTimeout(r, 40));
        cb.onContent?.('on it'); // the words stream to the UI as they arrive
        return { text: 'on it', reasoning: '', toolCalls: [writeCall('w', task === 'SLOW' ? 'slow.txt' : 'fast.txt')], usage: { promptTokens: 100, completionTokens: 20 } };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 300));
      expect(mainTail).toEqual(['a', 'b']);
      expect(existsSync(join(dir, 'slow.txt')) && existsSync(join(dir, 'fast.txt'))).toBe(true);
      expect(reports).toContain('[Files modified by this subagent: slow.txt]');
      expect(reports).toContain('[Files modified by this subagent: fast.txt]');

      // what the UI gets: nested cards under the parent in Claude's names, a lane with real token counts
      const log = s.log.after(0);
      const nested = log.filter((e) => e.type === 'tool_start' && e.parentId);
      expect(nested.map((e) => (e as { name: string }).name)).toEqual(expect.arrayContaining(['Write']));
      expect(new Set(nested.map((e) => (e as { id: string }).id)).size).toBe(2); // ids stay unique across subagents
      expect(log.some((e) => e.type === 'tool_start' && e.name === 'Task' && !e.parentId)).toBe(true);
      const lane = [...log].reverse().find((e) => e.type === 'task' && e.state === 'completed') as Extract<SessionEvent, { type: 'task' }>;
      expect(lane.tokens).toBe(240);
      expect(log.some((e) => e.type === 'block_start' && e.parentId)).toBe(true); // the subagent's own words are tied to its card
      s.close();
    });

    it('a batch where agents have no files, or share one, is refused whole and no agent runs', async () => {
      let subRuns = 0;
      const seen: string[] = [];
      let mainCalls = 0;
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (isSub(req)) { subRuns++; return { text: 'done', reasoning: '', toolCalls: [] }; }
        mainCalls++;
        if (req.messages.at(-1)?.role === 'tool') seen.push(req.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' || '));
        if (mainCalls === 1) return { text: '', reasoning: '', toolCalls: [subCall('a', 'ONE', ['engine.js']), subCall('b', 'TWO')] }; // b has no files
        if (mainCalls === 2) return { text: '', reasoning: '', toolCalls: [subCall('c', 'ONE', ['app.js']), subCall('d', 'TWO', ['app.js'])] }; // both want app.js
        return { text: 'planned again', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 250));
      expect(subRuns).toBe(0);
      expect(seen[0]).toContain('Batch not run');
      expect(seen[0]).toContain('"Builder b"');
      expect(seen[1]).toContain('both own');
      // the refused calls are still drawn as cards, and failed
      expect(s.log.after(0).filter((e) => e.type === 'tool_end' && e.isError)).toHaveLength(4);
      s.close();
    });

    it('an agent cannot write outside its files, and the lead is told what was refused', async () => {
      let subCalls = 0;
      let refusal = '';
      let report = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (!isSub(req)) {
          if (req.messages.at(-1)?.role === 'tool') report = String(req.messages.at(-1)!.content);
          return req.messages.at(-1)?.role === 'tool' ? { text: 'done', reasoning: '', toolCalls: [] } : { text: '', reasoning: '', toolCalls: [subCall('a', 'WRITE', ['own.txt'])] };
        }
        subCalls++;
        if (subCalls === 1) return { text: '', reasoning: '', toolCalls: [writeCall('w1', 'not-mine.txt')] };
        if (subCalls === 2) { refusal = String(req.messages.at(-1)?.content); return { text: '', reasoning: '', toolCalls: [writeCall('w2', 'own.txt')] }; }
        return { text: 'STATUS: BLOCKED. NEEDS FROM LEAD: not-mine.txt', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 250));
      expect(existsSync(join(dir, 'not-mine.txt'))).toBe(false);
      expect(existsSync(join(dir, 'own.txt'))).toBe(true);
      expect(refusal).toContain('not one of your files');
      expect(report).toContain('[Files modified by this subagent: own.txt]');
      expect(report).toContain('Writes refused');
      expect(report).toContain('not-mine.txt');
      s.close();
    });

    it('the agent\'s brief carries its files, its contract and the check it must run', async () => {
      let system = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (isSub(req)) { system = String(req.messages[0]?.content); return { text: 'STATUS: DONE', reasoning: '', toolCalls: [] }; }
        return req.messages.at(-1)?.role === 'tool' ? { text: 'ok', reasoning: '', toolCalls: [] } : { text: '', reasoning: '', toolCalls: [{ id: 'x', type: 'function', function: { name: 'invoke_subagent', arguments: JSON.stringify({ role: 'Engine', description: 'd', prompt: 'p', files: ['engine.js'], check: 'node engine.test.js' }) } }] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 200));
      expect(system).toContain('the ONLY ones you may create or change: engine.js');
      expect(system).toContain('run node engine.test.js');
      expect(system).toContain('STATUS: DONE or BLOCKED');
      s.close();
    });

    it('a subagent starts, reads and stops a background command through the session\'s tracked jobs, and "&" is refused for it and for the lead', async () => {
      const seen: string[] = [];
      let subCalls = 0;
      let leadCalls = 0;
      let leadRefusal = '';
      const sub = (name: string, args: object) => ({ text: '', reasoning: '', toolCalls: [{ id: `s${subCalls}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (isSub(req)) {
          if (req.messages.at(-1)?.role === 'tool') seen.push(String(req.messages.at(-1)!.content));
          subCalls++;
          if (subCalls === 1) return sub('bash', { command: 'node -e "console.log(7);setTimeout(()=>{},60000)"', run_in_background: true });
          if (subCalls === 2) { await new Promise((r) => setTimeout(r, 700)); return sub('bash_output', { id: /bg_\w+/.exec(seen.at(-1) ?? '')?.[0] ?? '' }); }
          if (subCalls === 3) return sub('bash_kill', { id: /bg_\w+/.exec(seen[0] ?? '')?.[0] ?? '' });
          if (subCalls === 4) return sub('bash', { command: 'python -m http.server 8000 &' });
          return { text: 'STATUS: DONE', reasoning: '', toolCalls: [] };
        }
        leadCalls++;
        if (req.messages.at(-1)?.role === 'tool' && leadCalls === 3) leadRefusal = String(req.messages.at(-1)!.content);
        if (leadCalls === 1) return { text: '', reasoning: '', toolCalls: [subCall('a', 'SERVE', ['server.js'])] };
        if (leadCalls === 2) return { text: '', reasoning: '', toolCalls: [{ id: 'l', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'npm run dev &' }) } }] };
        return { text: 'done', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('serve it');
      await new Promise((r) => setTimeout(r, 1500));
      expect(seen[0]).toContain('Started in the background as bg_');
      expect(seen[1]).toContain('7');
      expect(seen[1]).toContain('still running');
      expect(seen[2]).toBe('Stopped.');
      expect(seen[3]).toContain('run_in_background');
      expect(leadRefusal).toContain('run_in_background');
      s.close();
    });

    it('a subagent that only acknowledges is pushed once to do the work', async () => {
      let subCalls = 0;
      let nudge = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (!isSub(req)) return req.messages.at(-1)?.role === 'tool' ? { text: 'done', reasoning: '', toolCalls: [] } : { text: '', reasoning: '', toolCalls: [subCall('a', 'DO IT')] };
        subCalls++;
        if (subCalls === 1) return { text: 'Understood, I will do that.', reasoning: '', toolCalls: [] };
        if (subCalls === 2) { nudge = String(req.messages.at(-1)?.content); return { text: '', reasoning: '', toolCalls: [writeCall('w', 'out.txt')] }; }
        return { text: 'wrote out.txt', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 200));
      expect(nudge).toContain('nothing has been done yet');
      expect(existsSync(join(dir, 'out.txt'))).toBe(true);
      s.close();
    });

    it('a subagent obeys the permission mode: in plan mode it cannot write', async () => {
      let subCalls = 0;
      let refusal = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        if (!isSub(req)) return req.messages.at(-1)?.role === 'tool' ? { text: 'done', reasoning: '', toolCalls: [] } : { text: '', reasoning: '', toolCalls: [subCall('a', 'WRITE')] };
        subCalls++;
        if (subCalls === 1) return { text: '', reasoning: '', toolCalls: [writeCall('w', 'nope.txt')] };
        refusal = String(req.messages.at(-1)?.content);
        return { text: 'could not', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'plan' });
      s.prompt('go');
      await new Promise((r) => setTimeout(r, 200));
      expect(existsSync(join(dir, 'nope.txt'))).toBe(false);
      expect(refusal).toContain('Plan mode is read-only');
      s.close();
    });
  });

  it('the permission card shows Claude\'s tool name and the diff of an edit', async () => {
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 'e', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'a.ts', old_string: 'x', new_string: 'y' }) } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp });
    s.prompt('edit');
    await tick();
    const req = s.log.after(0).find((e) => e.type === 'permission_request') as Extract<SessionEvent, { type: 'permission_request' }>;
    expect(req.tool).toBe('Edit');
    expect(req.input).toEqual({ file_path: 'a.ts', old_string: 'x', new_string: 'y' });
    // the UI draws the diff from this input, exactly as it does for Claude's Edit
    expect(diffFor(req.tool, req.input)?.map((l) => `${l.kind}:${l.text}`)).toEqual(['del:x', 'add:y']);
    s.interrupt();
  });

  it('an overwrite is shown against the old content, so the card can say which lines were erased', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-ow-'));
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 'w', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'one\nTWO\nthree\n' }) } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: dir });
    s.prompt('overwrite');
    await tick();
    const shown = s.log.after(0).find((e) => e.type === 'tool_input') as Extract<SessionEvent, { type: 'tool_input' }>;
    expect(shown.input).toMatchObject({ file_path: 'a.txt', content: 'one\nTWO\nthree\n', old_content: 'one\ntwo\nthree\n' });
    await s.interrupt();
    s.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('a slow tool reports its seconds, and thinking reports its size, like Claude\'s cards', async () => {
    process.env.CLAUDEINTERFACE_ALLOW_BYPASS = '1';
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (_req, cb) => {
      calls++;
      if (calls === 1) {
        cb.onReasoning?.('r'.repeat(400));
        return { text: '', reasoning: 'r'.repeat(400), toolCalls: [{ id: 'b', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'node -e "setTimeout(()=>{},1500)"' }) } }] };
      }
      return { text: 'done', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'bypassPermissions' });
    s.prompt('wait');
    await new Promise((r) => setTimeout(r, 2600));
    delete process.env.CLAUDEINTERFACE_ALLOW_BYPASS;
    const log = s.log.after(0);
    expect(log.some((e) => e.type === 'tool_progress' && e.id === 'b' && e.elapsedSec >= 1)).toBe(true);
    expect(log.some((e) => e.type === 'thinking_progress' && e.estimatedTokens === 100)).toBe(true);
    s.close();
  }, 10_000);

  it('set_thinking switches reasoning off for the next calls, tells the UI, and a subagent follows it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-think-'));
    const seen: { thinking: unknown; kwargs: unknown; who: string }[] = [];
    let mainCalls = 0;
    let subCalls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      const isSub = String(req.messages[0]?.content).includes('working as a subagent');
      seen.push({ thinking: req.enableThinking, kwargs: req.templateKwargs, who: isSub ? 'sub' : 'main' });
      if (isSub) { subCalls++; return { text: subCalls === 1 ? 'done: nothing to change' : 'ok', reasoning: '', toolCalls: [] }; }
      mainCalls++;
      const call = (name: string, args: object) => ({ text: '', reasoning: '', toolCalls: [{ id: `c${mainCalls}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] });
      if (mainCalls === 1) return call('set_thinking', { enabled: false });
      if (mainCalls === 2) return call('invoke_subagent', { role: 'R', description: 'd', prompt: 'p' });
      return { text: 'done', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: dir });
    s.prompt('go');
    await new Promise((r) => setTimeout(r, 250));
    const mains = seen.filter((x) => x.who === 'main');
    expect(mains[0]!.thinking).toBe(true); // on by default, as the models themselves do
    expect(mains[1]!.thinking).toBe(false); // off from the next step
    expect(seen.find((x) => x.who === 'sub')!.thinking).toBe(false); // the subagent inherits it
    expect(s.log.after(0).some((e) => e.type === 'status' && e.thinking === false)).toBe(true);
    expect([...s.log.after(0)].reverse().find((e) => e.type === 'session_init')).toMatchObject({ thinking: false });
    s.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('set_thinking on a model that always reasons changes nothing and says so', async () => {
    let answer = '';
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
      calls++;
      if (req.messages.at(-1)?.role === 'tool') answer = String(req.messages.at(-1)!.content);
      return calls === 1
        ? { text: '', reasoning: '', toolCalls: [{ id: 't', type: 'function', function: { name: 'set_thinking', arguments: JSON.stringify({ enabled: false }) } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, model: 'mistralai/mistral-large-4-1t-a52b' });
    s.prompt('go');
    await tick();
    await tick();
    expect(answer).toContain('always reasons');
    expect([...s.log.after(0)].reverse().find((e) => e.type === 'session_init')).toMatchObject({ thinking: undefined });
    s.close();
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

  describe('the lead is not allowed to call it done unchecked, or to loop', () => {
    const call = (id: string, name: string, args: object) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ci-gate-')); process.env.CLAUDEINTERFACE_ALLOW_BYPASS = '1'; });
    afterEach(() => { delete process.env.CLAUDEINTERFACE_ALLOW_BYPASS; rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

    it('changed code with no run is sent back once; after a run it may finish', async () => {
      const last: string[] = [];
      let calls = 0;
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        calls++;
        last.push(String(req.messages.at(-1)?.content).slice(0, 40));
        if (calls === 1) return { text: '', reasoning: '', toolCalls: [call('w', 'write_file', { path: 'calc.js', content: 'console.log(1)' })] };
        if (calls === 2) return { text: 'All done, it works!', reasoning: '', toolCalls: [] }; // tries to finish unchecked
        if (calls === 3) return { text: '', reasoning: '', toolCalls: [call('b', 'bash', { command: 'node calc.js' })] };
        return { text: 'Verified: node calc.js printed 1.', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('write calc.js');
      await new Promise((r) => setTimeout(r, 800));
      expect(calls).toBe(4);
      expect(last[2]).toContain('[Harness reminder');
      expect(s.log.after(0).filter((e) => e.type === 'notice' && e.text.includes('sent back to check'))).toHaveLength(1);
      expect(s.log.after(0).filter((e) => e.type === 'result' && e.ok)).toHaveLength(1);
      s.close();
    });

    it('a UI file needs a look at the page: a build is not enough, and the reminder comes once', async () => {
      let calls = 0;
      let reminder = '';
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        calls++;
        if (String(req.messages.at(-1)?.content).includes('[Harness reminder')) reminder = String(req.messages.at(-1)?.content);
        if (calls === 1) return { text: '', reasoning: '', toolCalls: [call('w', 'write_file', { path: 'index.html', content: '<p>x</p>' }), call('b', 'bash', { command: 'node -e "1"' })] };
        return { text: 'done', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('make a page');
      await new Promise((r) => setTimeout(r, 500));
      expect(reminder).toContain('browser');
      expect(reminder).toContain('screenshot');
      expect(calls).toBe(3); // the call, the premature "done", the answer after the reminder: no loop
      s.close();
    });

    it('the same failing call twice is warned about and the third is not run', async () => {
      const results: string[] = [];
      let calls = 0;
      vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async (req) => {
        calls++;
        if (req.messages.at(-1)?.role === 'tool') results.push(String(req.messages.at(-1)!.content));
        return calls <= 3 ? { text: '', reasoning: '', toolCalls: [call(`r${calls}`, 'read_file', { path: 'missing.txt' })] } : { text: 'giving up', reasoning: '', toolCalls: [] };
      });
      const s = new NvidiaSession({ cwd: dir, mode: 'bypassPermissions' });
      s.prompt('read it');
      await new Promise((r) => setTimeout(r, 400));
      expect(results[0]).toContain('File not found');
      expect(results[1]).toContain('failed twice');
      expect(results[2]).toContain('Blocked');
      s.close();
    });
  });

  it('a call cut off by the output limit says so and tells the model to write in smaller pieces', async () => {
    let calls = 0;
    vi.spyOn(NvidiaClient.prototype, 'streamChat').mockImplementation(async () => {
      calls++;
      return calls === 1
        ? { text: '', reasoning: '', finishReason: 'length', toolCalls: [{ id: 'w', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"export const a = ' } }] }
        : { text: 'ok', reasoning: '', toolCalls: [] };
    });
    const s = new NvidiaSession({ cwd: tmp, mode: 'plan' });
    s.prompt('write a big file');
    await tick();
    await tick();
    const end = s.log.after(0).find((e) => e.type === 'tool_end') as Extract<SessionEvent, { type: 'tool_end' }>;
    expect(end.isError).toBe(true);
    expect(end.result.text).toContain('hit the output limit');
    expect(end.result.text).toContain('smaller pieces');
    s.close();
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

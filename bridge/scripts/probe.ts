// Runs small real sessions against the Agent SDK and saves every raw message as a fixture.
// Usage: npx tsx bridge/scripts/probe.ts [scenario ...]   (no args = all)
// It spends a little of the logged-in account's usage and writes only to the scratch dir and bridge/test/fixtures.
// Exempt from the "only normalize.ts imports SDK types" rule: its job is to look at the SDK directly.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteSession, forkSession, getSessionMessages, listSessions, query, renameSession,
  type CanUseTool, type Options, type PermissionResult, type Query, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = Record<string, any>;

const FIXTURES = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const CWD = process.env.PROBE_CWD;
if (!CWD) throw new Error('Set PROBE_CWD to an empty scratch directory (outside the repo).');
const MODEL = process.env.PROBE_MODEL ?? 'haiku';
if (process.env.ANTHROPIC_API_KEY) console.warn('! ANTHROPIC_API_KEY is set: this run uses API billing, not the subscription.');

// ---- redaction: fixtures are committed, so personal paths and the account email never reach them
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const home = homedir();
let secrets: string[] = [];
function redactStr(s: string): string {
  for (const h of [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')]) s = s.replace(new RegExp(escRe(h), 'gi'), '<HOME>');
  for (const x of secrets) s = s.replaceAll(x, '<REDACTED>');
  // the bare username survives in project-slug paths and in streamed fragments that split a path across deltas
  return s.replace(new RegExp(escRe(userInfo().username), 'gi'), 'user');
}
const redact = (value: unknown) => redactStr(JSON.stringify(value));

class Pushable<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiter?: (r: IteratorResult<T>) => void;
  private closed = false;
  push(v: T) {
    if (this.waiter) { this.waiter({ value: v, done: false }); this.waiter = undefined; } else this.items.push(v);
  }
  end() { this.closed = true; this.waiter?.({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () =>
        this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false })
        : this.closed ? Promise.resolve({ value: undefined as never, done: true })
        : new Promise((r) => { this.waiter = r; }),
    };
  }
}

type Ctx = { q: Query; seen: Msg[]; userUuid: string; note: (k: string, v: unknown) => void };
type Scenario = {
  prompt: string;
  mode?: Options['permissionMode'];
  persist?: boolean;
  followUp?: string; // sent after the first result, to see whether the session survives (e.g. after an interrupt)
  queued?: { text: string; priority?: 'now' | 'next' | 'later' }; // sent right after the prompt, while the turn runs
  options?: Partial<Options>;
  env?: Record<string, string>;
  decide?: (tool: string, input: Record<string, unknown>) => PermissionResult | undefined;
  onMessage?: (m: Msg, c: Ctx) => Promise<void> | void;
};

const allow = (input: Record<string, unknown>): PermissionResult => ({ behavior: 'allow', updatedInput: input });

const scenarios: Record<string, Scenario> = {
  basic: {
    persist: true,
    prompt: 'Do these in order, tersely. 1) Read hello.txt with the Read tool. 2) Run `echo probe` with the Bash tool. 3) Reply with the single word done.',
  },
  edit: {
    persist: true, // file checkpoints live with the persisted session
    prompt: 'Use the Edit tool to change "hello" to "goodbye" in hello.txt. Then reply with the single word done.',
  },
  todo: {
    options: { tools: { type: 'preset', preset: 'claude_code' } },
    prompt: 'Use the TodoWrite tool (load it with ToolSearch "select:TodoWrite" if needed) to write a 2-item list, both pending, then call it again with both completed. Then reply with the single word done.',
  },
  tasks: {
    env: { CLAUDE_CODE_ENABLE_TASKS: '1' },
    prompt: 'Use TaskCreate (load it with ToolSearch "select:TaskCreate,TaskUpdate" if needed) to create two tasks, then TaskUpdate to mark both completed. Then reply with the single word done.',
  },
  subagent: {
    prompt: 'Use the Agent tool exactly once (general-purpose) to work out what 2+2 is, then reply with only its answer.',
  },
  queue: {
    prompt: 'Reply with the single word one.',
    queued: { text: 'Reply with the single word two.', priority: 'next' },
  },
  interrupt: {
    followUp: 'Reply with the single word alive.',
    prompt: 'Run this exact command with the Bash tool and wait for it: node -e "setTimeout(()=>{},60000)"',
    onMessage(m, c) {
      const usesBash = m.type === 'assistant' && m.message?.content?.some((b: Msg) => b.type === 'tool_use' && b.name === 'Bash');
      if (usesBash && !c.seen.some((x) => x.__interrupted)) {
        c.seen.push({ __interrupted: true });
        setTimeout(async () => c.note('interruptReceipt', (await c.q.interrupt().catch((e: Error) => ({ __error: e.message }))) ?? null), 4000);
      }
    },
  },
  ask: {
    prompt: 'Use the AskUserQuestion tool to ask which colour I prefer, red or blue. Then reply with only my choice.',
    decide(tool, input) {
      if (tool !== 'AskUserQuestion') return undefined;
      const qs = input.questions as { question: string }[];
      return allow({ ...input, answers: Object.fromEntries(qs.map((x) => [x.question, 'blue'])) });
    },
  },
  plan: {
    mode: 'plan',
    prompt: 'Plan how to create a file notes.txt containing the text x. Do not execute anything. Call ExitPlanMode when the plan is ready.',
  },
  denial: {
    prompt: 'Use the Write tool to create denied.txt containing the text hi. If it is refused, just say refused.',
    decide: (tool) => (tool === 'Write' ? { behavior: 'deny', message: 'Refused by the probe.' } : undefined),
  },
  slash: { prompt: '/context' },
};

// `full` (only the basic scenario) also records the account/model/usage calls; every other scenario keeps just the rewind probe
async function snapshot(q: Query, userUuids: string[], full: boolean) {
  const out: Record<string, unknown> = {};
  const grab = async (k: string, f: () => Promise<unknown>) => {
    try { out[k] = await f(); } catch (e) { out[k] = { __error: String((e as Error).message ?? e) }; }
  };
  for (const u of userUuids) await grab(`rewindFiles_dryRun_${u.slice(0, 8)}`, () => q.rewindFiles(u, { dryRun: true }));
  if (!full) return out;
  await grab('initializationResult', () => q.initializationResult());
  await grab('accountInfo', async () => {
    const a = await q.accountInfo();
    secrets = [...secrets, ...[a.email, a.organization].filter((x): x is string => !!x)];
    return a;
  });
  await grab('supportedModels', () => q.supportedModels());
  await grab('supportedAgents', () => q.supportedAgents());
  await grab('mcpServerStatus', () => q.mcpServerStatus());
  await grab('getContextUsage_summary', () => q.getContextUsage({ detail: 'summary' }));
  await grab('usage', () => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
  await grab('backgroundTasks', () => q.backgroundTasks());
  return out;
}

async function run(name: string, sc: Scenario) {
  const lines: string[] = [];
  const notes: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  const seen: Msg[] = [];
  const assistantUuids: string[] = [];
  const userUuid = randomUUID();
  const sentUuids = [userUuid];
  const input = new Pushable<SDKUserMessage>();
  const user = (text: string, uuid: string, priority?: 'now' | 'next' | 'later') =>
    ({ type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null, ...(priority && { priority }) }) as SDKUserMessage;
  input.push(user(sc.prompt, userUuid));
  if (sc.queued) {
    const u = randomUUID();
    sentUuids.push(u);
    input.push(user(sc.queued.text, u, sc.queued.priority));
  }
  const expectedResults = sc.followUp || sc.queued ? 2 : 1;
  let resultCount = 0;

  const canUseTool: CanUseTool = async (tool, inp, o) => {
    const { signal: _signal, ...rest } = o;
    lines.push(redact({ type: 'probe_permission_request', tool, input: inp, options: rest }));
    return sc.decide?.(tool, inp) ?? allow(inp);
  };
  const options: Options = {
    cwd: CWD, model: MODEL, effort: 'low', permissionMode: sc.mode ?? 'default',
    settingSources: [], persistSession: sc.persist ?? false,
    includePartialMessages: true, includeHookEvents: true, forwardSubagentText: true,
    promptSuggestions: true, enableFileCheckpointing: true, agentProgressSummaries: true,
    ...sc.options,
    canUseTool,
    onElicitation: async (r) => {
      lines.push(redact({ type: 'probe_elicitation', request: r }));
      return { action: 'decline' };
    },
    env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', CLAUDE_AGENT_SDK_CLIENT_APP: 'claudeinterface/0.0.0', ...sc.env },
  };

  const q = query({ prompt: input, options });
  const watchdog = setTimeout(() => { notes.timedOut = true; q.close(); }, 180_000);
  const ctx: Ctx = { q, seen, userUuid, note: (k, v) => { notes[k] = v; } };
  let sessionId = '';
  try {
    for await (const msg of q) {
      const m = msg as Msg;
      sessionId ||= m.session_id ?? '';
      const kind = m.subtype ? `${m.type}/${m.subtype}` : m.type === 'stream_event' ? `stream_event/${m.event?.type}` : m.type;
      counts[kind] = (counts[kind] ?? 0) + 1;
      lines.push(redact(m));
      if (m.type === 'assistant' && !m.parent_tool_use_id) assistantUuids.push(m.uuid);
      await sc.onMessage?.(m, ctx);
      if (m.type === 'result') {
        resultCount++;
        if (resultCount === 1) {
          notes.userUuids = sentUuids;
          Object.assign(notes, { methods: await snapshot(q, [...new Set([userUuid, m.user_message_uuid].filter(Boolean))], name === 'basic') });
          if (sc.followUp) {
            const u = randomUUID();
            sentUuids.push(u);
            input.push(user(sc.followUp, u));
          }
        }
        if (resultCount >= expectedResults) input.end();
      }
    }
  } catch (e) {
    notes.streamError = String((e as Error).message ?? e);
  } finally {
    clearTimeout(watchdog);
    input.end();
  }
  // second pass: the account email is only known after the snapshot, so earlier lines are redacted again here
  writeFileSync(join(FIXTURES, `${name}.jsonl`), lines.map(redactStr).join('\n') + '\n');
  writeFileSync(join(FIXTURES, `${name}.notes.json`), redact(notes) + '\n');
  console.log(`\n== ${name}: ${lines.length} lines${notes.streamError ? '  ERROR: ' + notes.streamError : ''}`);
  console.log(Object.entries(counts).sort().map(([k, v]) => `   ${String(v).padStart(4)}  ${k}`).join('\n'));
  return { sid: sessionId, assistantUuids };
}

async function history(sessionId: string) {
  const out: Record<string, unknown> = {};
  const grab = async (k: string, f: () => Promise<unknown>) => {
    try { out[k] = await f(); } catch (e) { out[k] = { __error: String((e as Error).message ?? e) }; }
  };
  const dir = CWD!;
  await grab('listSessions', () => listSessions({ dir }));
  await grab('getSessionMessages', async () => (await getSessionMessages(sessionId, { dir })).slice(0, 6));
  await grab('renameSession', () => renameSession(sessionId, 'probe session', { dir }));
  await grab('forkSession', async () => {
    const f = await forkSession(sessionId, { dir });
    await deleteSession(f.sessionId, { dir });
    return f;
  });
  await deleteSession(sessionId, { dir }).catch(() => {});
  writeFileSync(join(FIXTURES, 'history.json'), redact(out) + '\n');
  console.log('\n== history: ' + Object.entries(out).map(([k, v]) => `${k}=${(v as any)?.__error ? 'ERROR ' + (v as any).__error : 'ok'}`).join('  '));
}

mkdirSync(FIXTURES, { recursive: true });
mkdirSync(CWD, { recursive: true });
const wanted = process.argv.slice(2);
for (const [name, sc] of Object.entries(scenarios)) {
  if (wanted.length && !wanted.includes(name)) continue;
  writeFileSync(join(CWD, 'hello.txt'), 'hello world\n');
  rmSync(join(CWD, 'notes.txt'), { force: true });
  const { sid } = await run(name, sc);
  if (name === 'basic' && sid) await history(sid);
  else if (sc.persist && sid) await deleteSession(sid, { dir: CWD }).catch(() => {});
}

// Conversation rewind: continue a persisted session as a fork that ends at an earlier assistant message.
if (!wanted.length || wanted.includes('resume')) {
  const first = await run('resume1', {
    persist: true,
    prompt: 'Remember the number 7. Reply with the single word ok.',
    followUp: 'Now remember the number 9 instead. Reply with the single word ok.',
  });
  const cut = first.assistantUuids[0]; // the reply to the first prompt only
  if (first.sid && cut) {
    const second = await run('resume2', {
      persist: true,
      prompt: 'Which number did I ask you to remember? Answer with just the number.',
      options: { resume: first.sid, forkSession: true, resumeSessionAt: cut },
    });
    for (const id of [first.sid, second.sid]) if (id) await deleteSession(id, { dir: CWD }).catch(() => {});
  }
}

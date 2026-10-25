// The UI is a projection of the session's event log (PLAN.md §4 rule 1): `reduce(view, event)` is the whole story.
// It is a plain function so it can be tested by feeding it the recorded real sessions.
import type { PermissionMode, Question, RateWindow, SessionEvent, SessionState } from '@ci/shared';
import type { ContextView, LaneView, PermissionDecision, TodoItem, TranscriptItem } from '../model.ts';
import { middleTruncate } from '../text.ts';
import { describeTool, diffFor, todosFrom } from './describe.ts';

type Init = Extract<SessionEvent, { type: 'session_init' }>;
type Models = Extract<SessionEvent, { type: 'models' }>['models'];

export type SessionView = {
  id: string;
  cwd: string;
  /** highest event number applied; reconnecting asks for everything after it */
  lastSeq: number;
  state: SessionState;
  init?: Init;
  models: Models;
  mode: PermissionMode;
  items: TranscriptItem[];
  queued: { id: string; text: string }[];
  suggestion?: string;
  context?: ContextView;
  limits: { status: 'allowed' | 'allowed_warning' | 'rejected'; fiveHour?: RateWindow; sevenDay?: RateWindow; resetsAt?: number };
  tasks: LaneView[];
  background: number;
  todos: TodoItem[];
  retrying?: { attempt: number; max: number };
  /** set when the session cannot continue; the screen offers to resume it */
  crashed?: string;
  /** the last finished assistant message, announced to screen readers once, not per token */
  announce: string;
  /** when each tool or thinking block started (bridge time), to show how long it took */
  starts: Record<string, number>;
  /** answers collected so far for requests that hold several questions */
  asking: Record<string, { questions: Question[]; answers: Record<string, string[]> }>;
};

/** Subagent lanes. Shell commands are tasks too (taskType local_bash) but are chips, not lanes; later updates for them arrive without a type, so they must stay in the list. */
export const lanesOf = (v: SessionView): LaneView[] => v.tasks.filter((t) => t.type !== 'local_bash');

export function initialView(id: string, cwd: string): SessionView {
  return {
    id, cwd, lastSeq: 0, state: 'idle', models: [], mode: 'default', items: [], queued: [],
    limits: { status: 'allowed' }, tasks: [], background: 0, todos: [], announce: '', starts: {}, asking: {},
  };
}

const find = (items: TranscriptItem[], match: (i: TranscriptItem) => boolean) => {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i]!)) return i;
  return -1;
};
const replaceAt = (items: TranscriptItem[], i: number, item: TranscriptItem) => items.map((x, j) => (j === i ? item : x));
const toolIndex = (items: TranscriptItem[], id: string) => find(items, (i) => i.kind === 'tool' && i.tool.id === id);
const depthOf = (items: TranscriptItem[], parentId?: string) => {
  if (!parentId) return 0;
  const p = items[toolIndex(items, parentId)];
  return (p?.kind === 'tool' ? (p.tool.depth ?? 0) : 0) + 1;
};

const scopeToDecision: Record<string, PermissionDecision> = {
  once: 'allowed-once', session: 'allowed-session', local: 'allowed-local', project: 'allowed-project', user: 'allowed-user',
};

function lane(prev: LaneView | undefined, e: Extract<SessionEvent, { type: 'task' }>): LaneView {
  return {
    id: e.taskId,
    type: e.subagentType ?? prev?.type ?? e.taskType ?? 'agent',
    description: e.description ?? prev?.description ?? '',
    state: e.state ?? prev?.state ?? 'running',
    toolUses: e.toolUses ?? prev?.toolUses ?? 0,
    tokens: e.tokens ?? prev?.tokens ?? 0,
    depth: e.depth ?? prev?.depth ?? 0,
  };
}

/** Apply one event. `instant` comes from the animation gate: true means "do not animate this one". */
export function reduce(view: SessionView, e: SessionEvent, instant: boolean): SessionView {
  if (e.seq <= view.lastSeq) return view; // a duplicate from a reconnect
  const v: SessionView = { ...view, lastSeq: e.seq };
  const add = (item: TranscriptItem): SessionView => ({ ...v, items: [...v.items, item] });
  const flag = instant ? { instant: true } : {};

  switch (e.type) {
    case 'session_init': return { ...v, init: e, mode: e.mode };
    case 'models': return { ...v, models: e.models };
    case 'session_state': return { ...v, state: e.state, retrying: e.state === 'retrying' ? v.retrying : undefined };
    case 'status': return e.mode ? { ...v, mode: e.mode } : v;
    case 'usage': return { ...v, context: { totalTokens: e.totalTokens, maxTokens: e.maxTokens } };
    case 'rate_limit': return { ...v, limits: { status: e.status, fiveHour: e.fiveHour ?? v.limits.fiveHour, sevenDay: e.sevenDay ?? v.limits.sevenDay, resetsAt: e.resetsAt } };
    case 'suggestion': return { ...v, suggestion: e.text };
    case 'retrying': return { ...v, retrying: { attempt: e.attempt, max: e.maxRetries } };
    case 'background_tasks': return { ...v, background: e.tasks.length };
    case 'prompt_queued': return { ...v, queued: [...v.queued, { id: e.id, text: e.text }] };
    case 'prompt_unqueued': return { ...v, queued: v.queued.filter((q) => q.id !== e.id) };

    case 'user_message': return { ...add({ kind: 'user', id: e.id, text: e.text, ...flag }), suggestion: undefined };

    case 'block_start': {
      if (e.parentId) return v; // a subagent's own text is shown with its lane (M3), not in the main conversation
      if (e.kind === 'thinking') return { ...add({ kind: 'thinking', id: e.blockId, tokens: 0, live: true }), starts: { ...v.starts, [e.blockId]: e.ts } };
      return add({ kind: 'assistant', id: e.blockId, text: '', streaming: true, synthetic: e.synthetic, ...flag });
    }
    case 'text_delta': {
      const i = find(v.items, (x) => x.kind === 'assistant' && x.id === e.blockId);
      const it = v.items[i];
      return i < 0 || it?.kind !== 'assistant' ? v : { ...v, items: replaceAt(v.items, i, { ...it, text: it.text + e.text }) };
    }
    case 'block_end': {
      const i = find(v.items, (x) => (x.kind === 'assistant' || x.kind === 'thinking') && x.id === e.blockId);
      const it = v.items[i];
      if (it?.kind === 'assistant') return { ...v, items: replaceAt(v.items, i, { ...it, streaming: false }), announce: it.text };
      if (it?.kind === 'thinking') return { ...v, items: replaceAt(v.items, i, { ...it, live: false, seconds: Math.max(1, Math.round((e.ts - (v.starts[e.blockId] ?? e.ts)) / 1000)) }) };
      return v;
    }
    case 'thinking_progress': {
      const i = find(v.items, (x) => x.kind === 'thinking' && x.live);
      const it = v.items[i];
      return it?.kind === 'thinking' ? { ...v, items: replaceAt(v.items, i, { ...it, tokens: e.estimatedTokens }) } : v;
    }

    case 'tool_start': {
      if (toolIndex(v.items, e.id) >= 0) return v;
      return { ...add({ kind: 'tool', tool: { id: e.id, name: e.name, target: '', status: 'running', depth: depthOf(v.items, e.parentId), ...flag } }), starts: { ...v.starts, [e.id]: e.ts } };
    }
    case 'tool_input': {
      const i = toolIndex(v.items, e.id);
      const it = v.items[i];
      const todos = it?.kind === 'tool' ? todosFrom(it.tool.name, e.input, v.todos) : v.todos;
      return it?.kind === 'tool' ? { ...v, todos, items: replaceAt(v.items, i, { kind: 'tool', tool: { ...it.tool, target: describeTool(it.tool.name, e.input), input: e.input } }) } : v;
    }
    case 'tool_progress': {
      const i = toolIndex(v.items, e.id);
      const it = v.items[i];
      return it?.kind === 'tool' ? { ...v, items: replaceAt(v.items, i, { kind: 'tool', tool: { ...it.tool, elapsedSec: e.elapsedSec } }) } : v;
    }
    case 'tool_end': {
      const i = toolIndex(v.items, e.id);
      const it = v.items[i];
      if (it?.kind !== 'tool') return v;
      const elapsedSec = (e.ts - (v.starts[e.id] ?? e.ts)) / 1000;
      return { ...v, items: replaceAt(v.items, i, { kind: 'tool', tool: { ...it.tool, status: e.isError ? 'error' : 'ok', output: e.result.text, images: e.result.imageData, truncatedBytes: e.result.truncated ? e.result.bytes : undefined, elapsedSec: it.tool.elapsedSec ?? elapsedSec } }) };
    }

    case 'permission_request': {
      const target = describeTool(e.tool, e.input) || e.description || '';
      return add({
        kind: 'permission',
        view: {
          id: e.reqId, title: `${e.displayName ?? e.tool}: ${middleTruncate(target, 90)}`, target, description: e.reason ?? (e.description && e.description !== target ? e.description : undefined),
          agent: e.agentId, diff: diffFor(e.tool, e.input), requiresUserInteraction: e.requiresUserInteraction, canRemember: e.canRemember,
          editable: (e.tool === 'Bash' || e.tool === 'PowerShell') && typeof e.input.command === 'string' ? { key: 'command', value: e.input.command } : undefined, ...flag,
        },
      });
    }
    case 'question': {
      const items: TranscriptItem[] = e.questions.map((q, n) => ({
        kind: 'question', view: { id: `${e.reqId}:${n}`, reqId: e.reqId, header: q.header, question: q.question, options: q.options.map(({ label, description }) => ({ label, description })), multiSelect: q.multiSelect, ...flag },
      }));
      return { ...v, items: [...v.items, ...items], asking: { ...v.asking, [e.reqId]: { questions: e.questions, answers: {} } } };
    }
    case 'plan': return add({ kind: 'plan', view: { id: e.reqId, text: e.markdown, ...flag } });
    case 'request_resolved': {
      const items = v.items.map((it): TranscriptItem => {
        if (it.kind === 'permission' && it.view.id === e.reqId) {
          const decision: PermissionDecision = e.outcome === 'allow' ? (scopeToDecision[e.scope ?? 'once'] ?? 'allowed-once') : e.outcome === 'cancelled' ? 'cancelled' : 'denied';
          return { kind: 'permission', view: { ...it.view, decision, denyReason: e.reason, instant: true } };
        }
        if (it.kind === 'plan' && it.view.id === e.reqId) {
          return { kind: 'plan', view: { ...it.view, decision: e.outcome === 'allow' ? (e.scope === 'approve_auto' ? 'approved-auto' : 'approved-manual') : 'rejected', instant: true } };
        }
        if (it.kind === 'question' && it.view.reqId === e.reqId && !it.view.answer) {
          const given = v.asking[e.reqId]?.answers[it.view.question];
          return { kind: 'question', view: { ...it.view, answer: given ?? ['(cancelled)'], instant: true } };
        }
        return it;
      });
      const { [e.reqId]: _done, ...asking } = v.asking;
      return { ...v, items, asking };
    }
    case 'permission_denied': return add({ kind: 'notice', id: `pd:${e.seq}`, level: 'warning', text: e.message });

    case 'task': {
      const prev = v.tasks.find((t) => t.id === e.taskId);
      const next = lane(prev, e);
      return { ...v, tasks: prev ? v.tasks.map((t) => (t.id === e.taskId ? next : t)) : [...v.tasks, next] };
    }

    case 'compact': return add({ kind: 'compact', id: `c:${e.seq}`, before: e.preTokens, after: e.postTokens ?? 0 });
    case 'notice': return add({ kind: 'notice', id: `n:${e.seq}`, level: e.level, text: e.text });
    case 'conversation_reset': return add({ kind: 'notice', id: `r:${e.seq}`, level: 'info', text: 'Conversation cleared.' });
    case 'result': {
      if (e.stopped) return add({ kind: 'stopped', id: `s:${e.seq}` });
      if (!e.ok) return add({ kind: 'notice', id: `f:${e.seq}`, level: 'danger', text: e.message || `The turn failed${e.errorKind ? ` (${e.errorKind.replaceAll('_', ' ')})` : ''}.` });
      return v;
    }
    case 'error':
      return e.recoverable ? add({ kind: 'notice', id: `e:${e.seq}`, level: 'danger', text: e.message }) : { ...v, crashed: e.message };
    case 'session_ended': return { ...v, state: 'ended', crashed: v.crashed ?? (e.reason === 'closed' || e.reason === 'finished' ? undefined : e.reason) };
    case 'unknown': return add({ kind: 'unknown', id: `u:${e.seq}`, raw: e.raw });
    default: return v; // sdk_state, hook, tool_summary, commands_changed, auth: nothing to draw yet
  }
}

/**
 * Remember one answer. A request can hold up to four questions (AskUserQuestion); the reply is only sent once every
 * one of them is answered, so `complete` is set only then (several choices of a multi-select are joined with ", ").
 */
export function recordAnswer(view: SessionView, viewId: string, labels: string[]): { view: SessionView; complete?: { reqId: string; answers: Record<string, string> } } {
  const item = view.items.find((i) => i.kind === 'question' && i.view.id === viewId);
  if (item?.kind !== 'question' || !item.view.reqId) return { view };
  const reqId = item.view.reqId;
  const ask = view.asking[reqId];
  if (!ask) return { view };
  const answers = { ...ask.answers, [item.view.question]: labels };
  const next: SessionView = {
    ...view,
    asking: { ...view.asking, [reqId]: { ...ask, answers } },
    items: view.items.map((i) => (i.kind === 'question' && i.view.id === viewId ? { kind: 'question', view: { ...i.view, answer: labels, instant: true } } : i)),
  };
  const done = ask.questions.every((q) => answers[q.question]?.length);
  return done ? { view: next, complete: { reqId, answers: Object.fromEntries(ask.questions.map((q) => [q.question, answers[q.question]!.join(', ')])) } } : { view: next };
}

/** The whole output of a tool has arrived (it was cut for the wire): replace the cut text. */
export function applyFull(view: SessionView, toolId: string, text: string): SessionView {
  const i = toolIndex(view.items, toolId);
  const it = view.items[i];
  return it?.kind === 'tool' ? { ...view, items: replaceAt(view.items, i, { kind: 'tool', tool: { ...it.tool, output: text, truncatedBytes: undefined, full: true } }) } : view;
}

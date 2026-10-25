// The ONLY file that knows what the Agent SDK's messages look like (PLAN.md §4 rule 2). It turns them into
// the UI contract in shared/events.ts. SDK payloads are not trusted shapes (they change with every CLI release),
// so every field goes through the guards below and anything unexpected becomes an `unknown` event, never an exception.
import { effortLevels, type AuthMode, type Effort, type ImageData, type PermissionMode, type Question, type SessionEventBody, type ToolResult } from '@ci/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;
const isObj = (x: unknown): x is J => typeof x === 'object' && x !== null;
const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d);
const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'];
const mode = (x: unknown): PermissionMode | undefined => (MODES.includes(x as PermissionMode) ? (x as PermissionMode) : undefined);

function authMode(apiKeySource: unknown): AuthMode {
  const s = str(apiKeySource);
  if (s === 'none' || s === 'oauth') return 'subscription';
  return s ? 'apikey' : 'other';
}

const MAX_IMAGES = 3;
const MAX_IMAGE_CHARS = 2_500_000; // base64 characters: about 1.8 MB of picture

export function toResult(content: unknown): ToolResult {
  if (typeof content === 'string') return { text: content, images: 0 };
  let images = 0;
  const imageData: ImageData[] = [];
  const parts: string[] = [];
  for (const c of arr(content)) {
    if (!isObj(c)) continue;
    if (c.type === 'text') parts.push(str(c.text));
    else if (c.type === 'image') {
      images++;
      const s = c.source;
      // only pictures that arrive inline and are small enough to send; the media type is checked so it can be used in a data: URL
      if (isObj(s) && s.type === 'base64' && /^image\/(png|jpe?g|gif|webp)$/.test(str(s.media_type)) && str(s.data).length <= MAX_IMAGE_CHARS && imageData.length < MAX_IMAGES) {
        imageData.push({ mediaType: str(s.media_type), data: str(s.data) });
      }
    } else if (c.type === 'tool_reference') parts.push(`[tool: ${str(c.tool_name)}]`);
  }
  return { text: parts.join('\n'), images, ...(imageData.length && { imageData }) };
}

const taskState = (s: unknown) =>
  s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : s === 'stopped' || s === 'killed' ? 'stopped' : s === 'running' ? 'running' : undefined;

const INTERRUPT_NOTICE = /^\[Request interrupted by user/;

/**
 * One per session. `live` messages come from query(); `history` messages come from getSessionMessages (no stream
 * events, and the user's own prompts are included). Both end up as the same events, so a resumed transcript looks like a live one.
 */
export function createNormalizer(source: 'live' | 'history' = 'live') {
  const currentMessage = new Map<string, string>(); // parent ("main" or a tool_use id) → API message id
  const openBlocks = new Map<string, { blockId: string; kind: 'text' | 'thinking' | 'tool' }>();
  const streamedBlocks = new Set<string>();
  const streamedTools = new Set<string>();
  const nextIndex = new Map<string, number>(); // API message id → index of the next block in a complete assistant message

  function stream(msg: J): SessionEventBody[] {
    const ev = msg.event;
    if (!isObj(ev)) return [];
    const parent = str(msg.parent_tool_use_id) || 'main';
    const parentId = str(msg.parent_tool_use_id) || undefined;
    const key = (i: number) => `${parent}:${i}`;
    switch (ev.type) {
      case 'message_start':
        currentMessage.set(parent, str(ev.message?.id, str(msg.api_message_id)));
        return [];
      case 'content_block_start': {
        const index = num(ev.index);
        const b = ev.content_block;
        if (!isObj(b)) return [];
        const blockId = `${currentMessage.get(parent) ?? str(msg.api_message_id)}:${index}`;
        if (b.type === 'text' || b.type === 'thinking') {
          openBlocks.set(key(index), { blockId, kind: b.type });
          streamedBlocks.add(blockId);
          return [{ type: 'block_start', blockId, kind: b.type, parentId }];
        }
        if (b.type === 'tool_use') {
          streamedTools.add(str(b.id));
          return [{ type: 'tool_start', id: str(b.id), name: str(b.name), parentId }];
        }
        return [];
      }
      case 'content_block_delta': {
        const open = openBlocks.get(key(num(ev.index)));
        const d = ev.delta;
        if (!open || !isObj(d)) return []; // input_json_delta and signature_delta are not needed by the UI
        if (d.type === 'text_delta') return [{ type: 'text_delta', blockId: open.blockId, text: str(d.text) }];
        if (d.type === 'thinking_delta') return d.thinking ? [{ type: 'thinking_delta', blockId: open.blockId, text: str(d.thinking) }] : [];
        return [];
      }
      case 'content_block_stop': {
        const open = openBlocks.get(key(num(ev.index)));
        if (!open) return [];
        openBlocks.delete(key(num(ev.index)));
        return open.kind === 'tool' ? [] : [{ type: 'block_end', blockId: open.blockId }];
      }
      default:
        return [];
    }
  }

  function assistant(msg: J): SessionEventBody[] {
    const m = msg.message;
    if (!isObj(m)) return [{ type: 'unknown', raw: msg }];
    const mid = str(m.id) || str(msg.uuid);
    const parentId = str(msg.parent_tool_use_id) || undefined;
    const synthetic = m.model === '<synthetic>';
    const out: SessionEventBody[] = [];
    for (const block of arr(m.content)) {
      if (!isObj(block)) continue;
      const index = nextIndex.get(mid) ?? 0;
      nextIndex.set(mid, index + 1);
      const blockId = `${mid}:${index}`;
      if (block.type === 'text' && !streamedBlocks.has(blockId)) {
        out.push({ type: 'block_start', blockId, kind: 'text', parentId, synthetic }, { type: 'text_delta', blockId, text: str(block.text) }, { type: 'block_end', blockId });
      } else if (block.type === 'thinking' && !streamedBlocks.has(blockId)) {
        out.push({ type: 'block_start', blockId, kind: 'thinking', parentId });
        if (block.thinking) out.push({ type: 'thinking_delta', blockId, text: str(block.thinking) });
        out.push({ type: 'block_end', blockId });
      } else if (block.type === 'tool_use') {
        const id = str(block.id);
        if (!streamedTools.has(id)) out.push({ type: 'tool_start', id, name: str(block.name), parentId });
        out.push({ type: 'tool_input', id, input: block.input ?? {} });
      }
    }
    if (typeof msg.error === 'string') out.push({ type: 'error', code: msg.error, message: `The request failed (${msg.error}).`, recoverable: true });
    return out;
  }

  function user(msg: J): SessionEventBody[] {
    const content = msg.message?.content;
    const parentId = str(msg.parent_tool_use_id) || undefined;
    if (typeof content === 'string') return source === 'history' && !msg.isSynthetic && !msg.isMeta ? [{ type: 'user_message', id: str(msg.uuid), text: content }] : [];
    const out: SessionEventBody[] = [];
    for (const block of arr(content)) {
      if (!isObj(block)) continue;
      if (block.type === 'tool_result') {
        out.push({ type: 'tool_end', id: str(block.tool_use_id), result: toResult(block.content), isError: block.is_error === true, parentId });
      } else if (block.type === 'text' && source === 'history' && !msg.isSynthetic && !msg.isMeta && !INTERRUPT_NOTICE.test(str(block.text))) {
        out.push({ type: 'user_message', id: str(msg.uuid), text: str(block.text) });
      }
    }
    return out;
  }

  function system(msg: J): SessionEventBody[] {
    switch (msg.subtype) {
      case 'init':
        return [{
          type: 'session_init',
          sdkSessionId: str(msg.session_id), cwd: str(msg.cwd), model: str(msg.model), mode: mode(msg.permissionMode) ?? 'default', version: str(msg.claude_code_version),
          authMode: authMode(msg.apiKeySource),
          tools: arr(msg.tools).map((t) => str(t)),
          slashCommands: arr(msg.slash_commands).map((t) => str(t)),
          agents: arr(msg.agents).map((t) => str(isObj(t) ? t.name : t)),
          skills: arr(msg.skills).map((t) => str(isObj(t) ? t.name : t)),
          mcpServers: arr(msg.mcp_servers).filter(isObj).map((s) => ({ name: str(s.name), status: str(s.status) })),
          outputStyle: str(msg.output_style, 'default'),
          capabilities: arr(msg.capabilities).map((t) => str(t)),
          addDirs: arr(msg.additional_directories).map((t) => str(t)),
          fastMode: typeof msg.fast_mode_state === 'string' ? msg.fast_mode_state : undefined,
        }];
      case 'session_state_changed':
        return msg.state === 'idle' || msg.state === 'running' || msg.state === 'requires_action' ? [{ type: 'sdk_state', state: msg.state }] : [];
      case 'status':
        return [{ type: 'status', compacting: msg.status === 'compacting', mode: mode(msg.permissionMode) }];
      case 'compact_boundary': {
        const c = isObj(msg.compact_metadata) ? msg.compact_metadata : {};
        return [{ type: 'compact', trigger: c.trigger === 'manual' ? 'manual' : 'auto', preTokens: num(c.pre_tokens), postTokens: typeof c.post_tokens === 'number' ? c.post_tokens : undefined, durationMs: typeof c.duration_ms === 'number' ? c.duration_ms : undefined }];
      }
      case 'api_retry':
        return [{ type: 'retrying', attempt: num(msg.attempt), maxRetries: num(msg.max_retries), delayMs: num(msg.retry_delay_ms), status: typeof msg.error_status === 'number' ? msg.error_status : null, error: str(msg.error) }];
      case 'thinking_tokens':
        return [{ type: 'thinking_progress', estimatedTokens: num(msg.estimated_tokens) }];
      case 'task_started':
        return [{ type: 'task', taskId: str(msg.task_id), toolUseId: str(msg.tool_use_id) || undefined, taskType: str(msg.task_type) || undefined, subagentType: str(msg.subagent_type) || undefined, description: str(msg.description), state: 'running', background: msg.is_backgrounded === true, depth: typeof msg.spawn_depth === 'number' ? msg.spawn_depth : undefined, parentTaskId: str(msg.parent_task_id) || undefined }];
      case 'task_progress': {
        const u = isObj(msg.usage) ? msg.usage : {};
        return [{ type: 'task', taskId: str(msg.task_id), tokens: num(u.total_tokens), toolUses: num(u.tool_uses), lastTool: str(msg.last_tool_name) || undefined, summary: str(msg.summary) || undefined, description: str(msg.description) || undefined }];
      }
      case 'task_updated': {
        const p = isObj(msg.patch) ? msg.patch : {};
        return [{ type: 'task', taskId: str(msg.task_id), state: taskState(p.status), background: typeof p.is_backgrounded === 'boolean' ? p.is_backgrounded : undefined, description: str(p.description) || undefined }];
      }
      case 'task_notification': {
        const u = isObj(msg.usage) ? msg.usage : undefined;
        return [{ type: 'task', taskId: str(msg.task_id), toolUseId: str(msg.tool_use_id) || undefined, state: taskState(msg.status), summary: str(msg.summary) || undefined, tokens: u ? num(u.total_tokens) : undefined, toolUses: u ? num(u.tool_uses) : undefined }];
      }
      case 'background_tasks_changed':
        return [{ type: 'background_tasks', tasks: arr(msg.tasks).filter(isObj).map((t) => ({ taskId: str(t.task_id), taskType: str(t.task_type) || undefined, subagentType: str(t.subagent_type) || undefined, description: str(t.description) || undefined })) }];
      case 'hook_started':
        return [{ type: 'hook', hookId: str(msg.hook_id), event: str(msg.hook_event), name: str(msg.hook_name), phase: 'started' }];
      case 'hook_progress':
        return [{ type: 'hook', hookId: str(msg.hook_id), event: str(msg.hook_event), name: str(msg.hook_name), phase: 'progress', output: str(msg.output) }];
      case 'hook_response':
        return [{ type: 'hook', hookId: str(msg.hook_id), event: str(msg.hook_event), name: str(msg.hook_name), phase: 'finished', outcome: msg.outcome === 'error' || msg.outcome === 'cancelled' ? msg.outcome : 'success', output: str(msg.output) }];
      case 'permission_denied':
        return [{ type: 'permission_denied', tool: str(msg.tool_name), toolUseId: str(msg.tool_use_id) || undefined, message: str(msg.message) }];
      case 'informational':
        return [{ type: 'notice', level: msg.level === 'warning' ? 'warning' : 'info', text: str(msg.content) }];
      case 'notification':
        return [{ type: 'notice', level: 'info', text: str(msg.text) }];
      case 'model_refusal_fallback':
        return [{ type: 'notice', level: 'warning', text: str(msg.content, `A fallback model (${str(msg.fallback_model)}) answered instead of ${str(msg.original_model)}.`) }];
      case 'model_refusal_no_fallback':
        return [{ type: 'notice', level: 'danger', text: str(msg.content, 'The model declined this request.') }];
      case 'commands_changed':
        return [{ type: 'commands_changed' }];
      case 'local_command_output': {
        const blockId = `local:${str(msg.uuid)}`;
        return [{ type: 'block_start', blockId, kind: 'text', synthetic: true }, { type: 'text_delta', blockId, text: str(msg.content) }, { type: 'block_end', blockId }];
      }
      // known, but nothing for the UI to show
      case 'files_persisted': case 'control_request_progress': case 'plugin_install': case 'memory_recall': case 'active_goal': case 'worker_shutting_down': case 'mirror_error':
        return [];
      default:
        return [{ type: 'unknown', raw: msg }];
    }
  }

  function result(msg: J): SessionEventBody {
    const subtype = str(msg.subtype);
    const terminalReason = str(msg.terminal_reason) || undefined;
    // Stop gives error_during_execution + aborted_tools: that is "Stopped", not a failure (PLAN.md §13.2)
    const stopped = subtype === 'error_during_execution' && terminalReason === 'aborted_tools';
    const ok = subtype === 'success' && msg.is_error !== true;
    const message = ok || stopped ? undefined : subtype === 'success' ? str(msg.result) : arr(msg.errors).map((e) => str(e)).join('\n') || undefined;
    return {
      type: 'result', ok, stopped, errorKind: subtype.startsWith('error_') ? subtype.slice(6) : undefined, terminalReason, message,
      costUsd: num(msg.total_cost_usd), durationMs: num(msg.duration_ms), turns: num(msg.num_turns), denials: arr(msg.permission_denials).length,
    };
  }

  function rateLimit(msg: J): SessionEventBody {
    const i = isObj(msg.rate_limit_info) ? msg.rate_limit_info : {};
    const w = (x: unknown) => (isObj(x) ? { utilization: num(x.utilization), resetsAt: num(x.resetsAt), status: str(x.status) } : undefined);
    const wins = isObj(i.unifiedWindows) ? i.unifiedWindows : {};
    return {
      type: 'rate_limit',
      status: i.status === 'allowed_warning' || i.status === 'rejected' ? i.status : 'allowed',
      resetsAt: typeof i.resetsAt === 'number' ? i.resetsAt : undefined,
      kind: str(i.rateLimitType) || undefined,
      utilization: typeof i.utilization === 'number' ? i.utilization : undefined,
      fiveHour: w(wins.five_hour),
      sevenDay: w(wins.seven_day),
    };
  }

  function handle(msg: unknown): SessionEventBody[] {
    if (!isObj(msg)) return [{ type: 'unknown', raw: msg }];
    switch (msg.type) {
      case 'stream_event': return stream(msg);
      case 'assistant': return assistant(msg);
      case 'user': return user(msg);
      case 'system': return source === 'history' ? [] : system(msg);
      case 'result': return [result(msg)];
      case 'rate_limit_event': return [rateLimit(msg)];
      case 'tool_progress': return [{ type: 'tool_progress', id: str(msg.tool_use_id), elapsedSec: num(msg.elapsed_time_seconds) }];
      case 'tool_use_summary': return [{ type: 'tool_summary', ids: arr(msg.preceding_tool_use_ids).map((x) => str(x)), text: str(msg.summary) }];
      case 'prompt_suggestion': return [{ type: 'suggestion', text: str(msg.suggestion) }];
      case 'auth_status': return [{ type: 'auth', authenticating: msg.isAuthenticating === true, output: arr(msg.output).map((x) => str(x)), error: str(msg.error) || undefined }];
      case 'conversation_reset': return [{ type: 'conversation_reset' }];
      case 'command_lifecycle': return []; // the bridge keeps its own prompt queue, so these add nothing
      default: return [{ type: 'unknown', raw: msg }];
    }
  }

  return {
    push(msg: unknown): SessionEventBody[] {
      try {
        return handle(msg);
      } catch {
        return [{ type: 'unknown', raw: msg }];
      }
    },
  };
}

// ---- things the bridge does not read from the message stream but from callbacks and method results ----

/** `canUseTool` arguments → the request event. AskUserQuestion and ExitPlanMode arrive through the same callback. */
export function permissionEvent(tool: string, input: Record<string, unknown>, o: J): SessionEventBody {
  const reqId = str(o.requestId);
  const toolUseId = str(o.toolUseID);
  if (tool === 'AskUserQuestion') {
    const questions: Question[] = arr(input.questions).filter(isObj).map((q) => ({
      question: str(q.question), header: str(q.header), multiSelect: q.multiSelect === true,
      options: arr(q.options).filter(isObj).map((x) => ({ label: str(x.label), description: str(x.description), preview: str(x.preview) || undefined })),
    }));
    return { type: 'question', reqId, toolUseId, questions };
  }
  if (tool === 'ExitPlanMode') return { type: 'plan', reqId, toolUseId, markdown: str(input.plan) };
  const requiresUserInteraction = o.requiresUserInteraction === true;
  return {
    type: 'permission_request', reqId, tool, toolUseId, input,
    displayName: str(o.displayName) || undefined, description: str(o.description) || undefined, reason: str(o.decisionReason) || undefined,
    blockedPath: str(o.blockedPath) || undefined, mcpServer: isObj(o.mcpServer) ? str(o.mcpServer.name) || undefined : undefined,
    agentId: str(o.agentID) || undefined, requiresUserInteraction,
    canRemember: !requiresUserInteraction && o.suppressAlwaysAllowRule !== true && arr(o.suggestions).length > 0,
  };
}

const DESTINATION = { session: 'session', local: 'localSettings', project: 'projectSettings', user: 'userSettings' } as const;

/**
 * "Allow for…" → the SDK's `updatedPermissions`. The scope the user picked replaces the destination of the rules
 * the CLI itself suggested; when it suggested none (or only a mode switch) a rule for the whole tool is used.
 */
export function permissionUpdates(tool: string, suggestions: unknown, scope: 'session' | 'local' | 'project' | 'user'): unknown[] {
  const destination = DESTINATION[scope];
  const rules = arr(suggestions).filter((s) => isObj(s) && s.type === 'addRules').map((s) => ({ ...s, destination }));
  if (rules.length) return rules;
  const modeSwitch = arr(suggestions).filter((s) => isObj(s) && s.type === 'setMode');
  if (scope === 'session' && modeSwitch.length) return modeSwitch;
  return [{ type: 'addRules', rules: [{ toolName: tool }], behavior: 'allow', destination }];
}

/** `getContextUsage()` → usage event. The method answers in camelCase although the SDKContextUsage *type* is snake_case. */
export function usageEvent(resp: unknown): SessionEventBody | undefined {
  if (!isObj(resp)) return undefined;
  const total = num(resp.totalTokens, num(resp.total_tokens, NaN));
  const max = num(resp.maxTokens, num(resp.raw_max_tokens, NaN));
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return undefined;
  return {
    type: 'usage', totalTokens: total, maxTokens: max, percentage: num(resp.percentage),
    categories: arr(resp.categories).filter(isObj).map((c) => ({ id: str(c.id), name: str(c.name), tokens: num(c.tokens) })),
  };
}

/** `supportedModels()` → models event, for the header's model and effort menus. */
export function modelsEvent(resp: unknown): SessionEventBody | undefined {
  const efforts = (x: unknown) => arr(x).filter((e): e is Effort => (effortLevels as readonly string[]).includes(e));
  const models = arr(resp).filter(isObj).map((m) => ({
    value: str(m.value), label: str(m.displayName, str(m.value)), description: str(m.description) || undefined,
    efforts: efforts(m.supportedEffortLevels), fast: m.supportsFastMode === true,
  })).filter((m) => m.value);
  return models.length ? { type: 'models', models } : undefined;
}

/** `supportedCommands()` → commands event, for the `/` picker and the palette. */
export function commandsEvent(resp: unknown): SessionEventBody | undefined {
  const commands = arr(resp).filter(isObj).map((c) => ({ name: str(c.name).replace(/^\//, ''), description: str(c.description) || undefined, hint: str(c.argumentHint) || undefined })).filter((c) => c.name);
  return commands.length ? { type: 'commands', commands } : undefined;
}

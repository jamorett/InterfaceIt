// The only contract between the bridge and the UI (PLAN.md §2). Nothing here mentions SDK message shapes:
// bridge/src/normalize.ts is the one file that translates them into these events.

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions';
export const permissionModes: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'];
export const effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof effortLevels)[number];

export type SessionState =
  | 'idle' | 'running' | 'awaiting_permission' | 'awaiting_answer' | 'compacting' | 'retrying' | 'rate_limited' | 'error' | 'ended';

export type AuthMode = 'subscription' | 'apikey' | 'other';

export type ToolResult = {
  text: string;
  images: number;
  /** set by the event log when the text was cut for the wire; `bytes` is the original size */
  truncated?: boolean;
  bytes?: number;
};

export type Question = {
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect: boolean;
};

export type RateWindow = { utilization: number; resetsAt: number; status: string };

export type BackgroundTask = { taskId: string; taskType?: string; subagentType?: string; description?: string };

/** A session event: everything the transcript, the status bar and the notifications are drawn from. */
export type SessionEventBody =
  | { type: 'session_init'; sdkSessionId: string; cwd: string; model: string; mode: PermissionMode; version: string; authMode: AuthMode; tools: string[]; slashCommands: string[]; agents: string[]; skills: string[]; mcpServers: { name: string; status: string }[]; outputStyle: string; capabilities: string[]; addDirs: string[]; fastMode?: string }
  | { type: 'session_state'; state: SessionState }
  | { type: 'models'; models: { value: string; label: string; description?: string; efforts: Effort[]; fast: boolean }[] }
  | { type: 'sdk_state'; state: 'idle' | 'running' | 'requires_action' }
  | { type: 'status'; compacting: boolean; mode?: PermissionMode }
  | { type: 'user_message'; id: string; text: string }
  | { type: 'prompt_queued'; id: string; text: string }
  | { type: 'prompt_unqueued'; id: string; reason: 'sent' | 'removed' | 'stopped' }
  | { type: 'block_start'; blockId: string; kind: 'text' | 'thinking'; parentId?: string; synthetic?: boolean }
  | { type: 'text_delta'; blockId: string; text: string }
  | { type: 'thinking_delta'; blockId: string; text: string }
  | { type: 'block_end'; blockId: string }
  | { type: 'thinking_progress'; estimatedTokens: number }
  | { type: 'tool_start'; id: string; name: string; parentId?: string }
  | { type: 'tool_input'; id: string; input: unknown }
  | { type: 'tool_progress'; id: string; elapsedSec: number }
  | { type: 'tool_end'; id: string; result: ToolResult; isError: boolean; parentId?: string }
  | { type: 'tool_summary'; ids: string[]; text: string }
  | { type: 'permission_request'; reqId: string; tool: string; toolUseId: string; input: Record<string, unknown>; displayName?: string; description?: string; reason?: string; blockedPath?: string; mcpServer?: string; agentId?: string; requiresUserInteraction: boolean; canRemember: boolean }
  | { type: 'question'; reqId: string; toolUseId: string; questions: Question[] }
  | { type: 'plan'; reqId: string; toolUseId: string; markdown: string }
  | { type: 'request_resolved'; reqId: string; outcome: 'allow' | 'deny' | 'cancelled' | 'answered'; scope?: string; reason?: string }
  | { type: 'permission_denied'; tool: string; toolUseId?: string; message: string }
  | { type: 'task'; taskId: string; toolUseId?: string; taskType?: string; subagentType?: string; description?: string; state?: 'running' | 'completed' | 'failed' | 'stopped'; background?: boolean; depth?: number; parentTaskId?: string; tokens?: number; toolUses?: number; lastTool?: string; summary?: string }
  | { type: 'background_tasks'; tasks: BackgroundTask[] }
  | { type: 'hook'; hookId: string; event: string; name: string; phase: 'started' | 'progress' | 'finished'; outcome?: 'success' | 'error' | 'cancelled'; output?: string }
  | { type: 'compact'; trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number; durationMs?: number }
  | { type: 'usage'; totalTokens: number; maxTokens: number; percentage: number; categories: { id: string; name: string; tokens: number }[] }
  | { type: 'rate_limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; kind?: string; utilization?: number; fiveHour?: RateWindow; sevenDay?: RateWindow }
  | { type: 'suggestion'; text: string }
  | { type: 'retrying'; attempt: number; maxRetries: number; delayMs: number; status: number | null; error: string }
  | { type: 'conversation_reset' }
  | { type: 'commands_changed' }
  | { type: 'notice'; level: 'info' | 'warning' | 'danger'; text: string }
  | { type: 'result'; ok: boolean; stopped: boolean; errorKind?: string; terminalReason?: string; message?: string; costUsd: number; durationMs: number; turns: number; denials: number }
  | { type: 'auth'; authenticating: boolean; output: string[]; error?: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'session_ended'; reason: string }
  | { type: 'unknown'; raw: unknown };

export type SessionEvent = SessionEventBody & {
  sessionId: string;
  /** monotonic per session, from 1: reconnecting asks for "everything after seq N" and duplicates are dropped */
  seq: number;
  /** when the bridge produced it (ms since epoch); the animation gate compares it with the arrival time */
  ts: number;
  /** produced from stored history rather than live: nothing about it may animate */
  replayed?: boolean;
};

export type SessionInfo = { id: string; cwd: string; title: string; updated: number; gitBranch?: string; live: boolean; /** the SDK's id when it differs from `id` (a fork) */ sdkId?: string };

export type Preflight = {
  /** a Claude Code binary could be run (the SDK's own, or `claude` on PATH) */
  cliFound: boolean;
  cliVersion?: string;
  cliTooOld: boolean;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  /** what to type in a terminal to sign in */
  loginCommand: string;
  /** recent projects, newest first */
  recentProjects: string[];
};

/** What the bridge sends outside any session. */
export type ServerEvent =
  | { type: 'ready' }
  | { type: 'preflight'; preflight: Preflight }
  | { type: 'session_list'; sessions: SessionInfo[] }
  | { type: 'session_opened'; sessionId: string; cwd: string; resumed: boolean }
  | { type: 'server_error'; code: 'untrusted_folder' | 'bad_command' | 'unknown_session' | 'start_failed' | 'not_a_folder'; message: string; detail?: string };

export type UiEvent = ServerEvent | SessionEvent;

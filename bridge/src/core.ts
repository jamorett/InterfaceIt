// What every session does regardless of what produces its messages: keep the event log, derive the status,
// run the prompt queue, and hold the questions Claude has asked until the user answers them.
// The real session (session.ts) and the fixture replay used by the UI tests (fixture.ts) both extend this.
import { randomUUID } from 'node:crypto';
import type { Effort, PermissionMode, SessionEvent, SessionEventBody, SessionInfo } from '@ci/shared';
import { EventLog } from './eventlog.ts';
import { permissionUpdates } from './normalize.ts';
import { StateTracker } from './state.ts';

/** The answer handed back to the SDK's `canUseTool`. */
export type Decision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

type Pending = {
  kind: 'permission' | 'question' | 'plan';
  tool: string;
  input: Record<string, unknown>;
  suggestions: unknown;
  resolve: (d: Decision) => void;
};

export interface SessionLike {
  readonly id: string;
  readonly cwd: string;
  readonly log: EventLog;
  info(): SessionInfo;
  subscribe(fn: (e: SessionEvent) => void): () => void;
  prompt(text: string): void;
  unqueue(promptId: string): void;
  interrupt(): Promise<void>;
  permissionReply(reqId: string, decision: 'allow' | 'deny', scope?: 'once' | 'session' | 'local' | 'project' | 'user', reason?: string, editedInput?: Record<string, unknown>): void;
  answer(reqId: string, answers: Record<string, string>): void;
  planReply(reqId: string, decision: 'approve_auto' | 'approve_manual' | 'reject', feedback?: string): void;
  setMode(mode: PermissionMode): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: Effort): Promise<void>;
  close(): void;
}

export abstract class SessionCore implements SessionLike {
  readonly log: EventLog;
  sdkId?: string;
  protected tracker = new StateTracker();
  protected ended = false;
  private listeners = new Set<(e: SessionEvent) => void>();
  private queue: { id: string; text: string }[] = [];
  /** a prompt was handed to the SDK but it has not said "running" yet: a second prompt must wait */
  private starting = false;
  private pending = new Map<string, Pending>();
  private title = 'New session';

  constructor(readonly id: string, readonly cwd: string) {
    this.log = new EventLog(id);
  }

  /** hand one prompt to whatever produces the answers */
  protected abstract deliver(id: string, text: string): void;
  /** stop the running turn */
  protected abstract stop(): Promise<void>;
  abstract setMode(mode: PermissionMode): Promise<void>;
  abstract setModel(model: string): Promise<void>;
  abstract setEffort(effort: Effort): Promise<void>;
  abstract close(): void;

  info(): SessionInfo {
    return { id: this.id, cwd: this.cwd, title: this.title, updated: Date.now(), live: true, sdkId: this.sdkId && this.sdkId !== this.id ? this.sdkId : undefined };
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Record events, tell the listeners, derive the status, and start the next queued prompt when the SDK goes idle. */
  protected ingest(bodies: SessionEventBody[]): void {
    for (const b of bodies) {
      this.emit(this.log.append(b));
      if (b.type === 'session_init') this.sdkId = b.sdkSessionId;
      if (b.type === 'sdk_state' && b.state === 'running') this.starting = false;
      if (b.type === 'result' || (b.type === 'error' && !b.recoverable)) this.starting = false; // never leave the queue stuck
      const next = this.tracker.apply(b);
      if (next) this.emit(this.log.append({ type: 'session_state', state: next }));
      if (b.type === 'sdk_state' && b.state === 'idle') this.sendNext();
    }
  }

  /** Stored history: recorded for replay, flagged so nothing animates, and it does not touch the live status. */
  seedHistory(bodies: SessionEventBody[]): void {
    for (const b of bodies) {
      if (b.type === 'user_message' && this.title === 'New session') this.title = b.text.slice(0, 80);
      this.log.append(b, { replayed: true });
    }
  }

  private emit(e: SessionEvent) {
    for (const l of this.listeners) l(e);
  }

  // ---- prompts ----
  prompt(text: string): void {
    const id = randomUUID();
    if (this.starting || this.tracker.busy || this.queue.length) {
      this.queue.push({ id, text });
      this.ingest([{ type: 'prompt_queued', id, text }]);
    } else this.send(id, text);
  }

  private send(id: string, text: string) {
    this.starting = true;
    if (this.title === 'New session') this.title = text.slice(0, 80);
    this.ingest([{ type: 'user_message', id, text }]);
    this.deliver(id, text);
  }

  private sendNext() {
    const next = this.queue.shift();
    if (!next) return;
    this.ingest([{ type: 'prompt_unqueued', id: next.id, reason: 'sent' }]);
    this.send(next.id, next.text);
  }

  unqueue(promptId: string): void {
    const i = this.queue.findIndex((q) => q.id === promptId);
    if (i < 0) return;
    this.queue.splice(i, 1);
    this.ingest([{ type: 'prompt_unqueued', id: promptId, reason: 'removed' }]);
  }

  /** Stop means stop: pending questions are cancelled and queued prompts dropped, then the turn is interrupted. */
  async interrupt(): Promise<void> {
    this.cancelPending();
    for (const q of this.queue.splice(0)) this.ingest([{ type: 'prompt_unqueued', id: q.id, reason: 'stopped' }]);
    await this.stop();
  }

  // ---- questions Claude asks the user (permissions, AskUserQuestion, plan review) ----
  /** Announce a request and wait for the user's answer. */
  protected request(event: Extract<SessionEventBody, { type: 'permission_request' | 'question' | 'plan' }>, tool: string, input: Record<string, unknown>, suggestions: unknown): Promise<Decision> {
    return new Promise((resolve) => {
      const kind = event.type === 'permission_request' ? 'permission' : event.type;
      this.pending.set(event.reqId, { kind, tool, input, suggestions, resolve });
      this.ingest([event]);
    });
  }

  /** the SDK gave up on a request (turn aborted): answer it so nothing hangs */
  protected abandon(reqId: string): void {
    this.settle(reqId, { behavior: 'deny', message: 'The request was cancelled.', interrupt: true }, 'cancelled');
  }

  private cancelPending() {
    for (const id of [...this.pending.keys()]) this.abandon(id);
  }

  private settle(reqId: string, decision: Decision, outcome: 'allow' | 'deny' | 'cancelled' | 'answered', extra: { scope?: string; reason?: string } = {}) {
    const p = this.pending.get(reqId);
    if (!p) return; // already answered, e.g. from another window
    this.pending.delete(reqId);
    p.resolve(decision);
    this.ingest([{ type: 'request_resolved', reqId, outcome, ...extra }]);
  }

  permissionReply(reqId: string, decision: 'allow' | 'deny', scope: 'once' | 'session' | 'local' | 'project' | 'user' = 'once', reason?: string, editedInput?: Record<string, unknown>): void {
    const p = this.pending.get(reqId);
    if (!p || p.kind !== 'permission') return;
    if (decision === 'deny') {
      this.settle(reqId, { behavior: 'deny', message: reason ? `The user denied this action: ${reason}` : 'The user denied this action.' }, 'deny', { reason });
    } else {
      const updatedPermissions = scope === 'once' ? undefined : permissionUpdates(p.tool, p.suggestions, scope);
      // the UI sends only the fields the user changed (the command of a Bash call); the rest of the input stays as Claude wrote it
      this.settle(reqId, { behavior: 'allow', updatedInput: editedInput ? { ...p.input, ...editedInput } : p.input, updatedPermissions }, 'allow', { scope });
    }
  }

  answer(reqId: string, answers: Record<string, string>): void {
    const p = this.pending.get(reqId);
    if (!p || p.kind !== 'question') return;
    this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.input, answers } }, 'answered');
  }

  planReply(reqId: string, decision: 'approve_auto' | 'approve_manual' | 'reject', feedback?: string): void {
    const p = this.pending.get(reqId);
    if (!p || p.kind !== 'plan') return;
    if (decision === 'reject') {
      this.settle(reqId, { behavior: 'deny', message: `The user rejected the plan.${feedback ? ` Their feedback: ${feedback}` : ''}` }, 'deny', { reason: feedback });
    } else {
      const updatedPermissions = decision === 'approve_auto' ? [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] : undefined;
      this.settle(reqId, { behavior: 'allow', updatedInput: p.input, updatedPermissions }, 'allow', { scope: decision });
    }
  }
}

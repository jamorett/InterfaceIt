import type { SessionEventBody, SessionState } from '@ci/shared';

/**
 * Derives the one status the whole UI is built around (PLAN.md §2 `session_state`) from the raw facts.
 * Verified against real sessions (§13.2): a `result` is NOT the end (a background subagent starts another turn),
 * so "idle" only ever comes from the SDK's own `idle`.
 */
export class StateTracker {
  private sdk: 'idle' | 'running' | 'requires_action' = 'idle';
  private pending = new Map<string, 'permission' | 'answer'>();
  private compacting = false;
  private retrying = false;
  private rateLimited = false;
  private failed = false;
  private ended = false;
  private current: SessionState = 'idle';

  /** Feed every event; returns the new state when it changed. */
  apply(e: SessionEventBody): SessionState | undefined {
    switch (e.type) {
      case 'sdk_state':
        this.sdk = e.state;
        this.retrying = false;
        if (e.state === 'running') this.failed = false;
        break;
      case 'permission_request': this.pending.set(e.reqId, 'permission'); break;
      case 'plan': this.pending.set(e.reqId, 'permission'); break;
      case 'question': this.pending.set(e.reqId, 'answer'); break;
      case 'request_resolved': this.pending.delete(e.reqId); break;
      case 'status': this.compacting = e.compacting; break;
      case 'retrying': this.retrying = true; break;
      case 'block_start': case 'tool_start': this.retrying = false; break;
      case 'rate_limit': this.rateLimited = e.status === 'rejected'; break;
      case 'result':
        this.retrying = false;
        this.failed = !e.ok && !e.stopped;
        break;
      case 'error':
        if (e.code === 'rate_limit') this.rateLimited = true;
        break;
      case 'session_ended': this.ended = true; break;
    }
    const next = this.derive();
    if (next === this.current) return undefined;
    this.current = next;
    return next;
  }

  private derive(): SessionState {
    if (this.ended) return 'ended';
    const kinds = new Set(this.pending.values());
    if (kinds.has('permission') || (this.sdk === 'requires_action' && !kinds.has('answer'))) return 'awaiting_permission';
    if (kinds.has('answer')) return 'awaiting_answer';
    if (this.compacting) return 'compacting';
    if (this.retrying) return 'retrying';
    if (this.rateLimited) return 'rate_limited';
    if (this.failed) return 'error';
    return this.sdk === 'running' ? 'running' : 'idle';
  }

  get state(): SessionState {
    return this.current;
  }

  /** true while the SDK is working on, or waiting for you in, a turn */
  get busy(): boolean {
    return this.sdk !== 'idle';
  }
}

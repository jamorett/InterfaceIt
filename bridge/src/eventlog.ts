import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionEvent, SessionEventBody } from '@ci/shared';

export const MAX_RESULT_CHARS = 64 * 1024;
const MAX_INPUT_STRING = 64 * 1024;

/** The append-only record of one session. The UI is a projection of it, which is what makes reconnecting, replay and a second window free. */
export class EventLog {
  private events: SessionEvent[] = [];

  constructor(readonly sessionId: string, private now: () => number = Date.now) {}

  append(body: SessionEventBody, extra: { replayed?: boolean } = {}): SessionEvent {
    const e = { ...body, ...extra, sessionId: this.sessionId, seq: this.events.length + 1, ts: this.now() } as SessionEvent;
    this.events.push(e);
    this.toDisk(e);
    return e;
  }

  /**
   * Opt-in post-mortem: with CLAUDEINTERFACE_LOG_DIR set, every event is also appended to <dir>/<session>.jsonl (pictures and
   * very long strings are cut). Off by default because tool output can hold anything the agent read. It never breaks a session.
   */
  private toDisk(e: SessionEvent): void {
    const dir = process.env.CLAUDEINTERFACE_LOG_DIR;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${this.sessionId}.jsonl`), `${JSON.stringify(forLog(e))}\n`);
    } catch { /* a full disk or a bad path must not stop the conversation */ }
  }

  /** everything after `seq` (seq numbers start at 1, so index === seq) */
  after(seq: number): SessionEvent[] {
    return this.events.slice(Math.max(0, seq));
  }

  all(): SessionEvent[] {
    return this.events.slice();
  }

  get lastSeq(): number {
    return this.events.length;
  }

  /** the untruncated tool result, for "show full output" */
  fullResult(toolId: string): string | undefined {
    for (const e of this.events) if (e.type === 'tool_end' && e.id === toolId) return e.result.text;
    return undefined;
  }
}

/** the event for the file on disk: base64 pictures become a size, long strings are cut */
function forLog(e: SessionEvent): unknown {
  const cut = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return key === 'data' && v.length > 200 ? `[${v.length} base64 characters]` : v.length > 20_000 ? `${v.slice(0, 20_000)}… (${v.length - 20_000} more characters)` : v;
    if (Array.isArray(v)) return v.map((x) => cut(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x, k)]));
    return v;
  };
  return cut(e);
}

function capStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}\n… (${value.length - max} more characters not sent)` : value;
  if (Array.isArray(value)) return value.map((v) => capStrings(v, max));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capStrings(v, max)]));
  return value;
}

/** What goes over the wire: huge tool output and huge tool input (a 1 MB file written by Write) are cut. The log keeps the original. */
export function forWire(e: SessionEvent): SessionEvent {
  if (e.type === 'tool_end' && e.result.text.length > MAX_RESULT_CHARS) {
    return { ...e, result: { ...e.result, text: e.result.text.slice(0, MAX_RESULT_CHARS), truncated: true, bytes: Buffer.byteLength(e.result.text) } };
  }
  if (e.type === 'tool_input') return { ...e, input: capStrings(e.input, MAX_INPUT_STRING) };
  if (e.type === 'permission_request') return { ...e, input: capStrings(e.input, MAX_INPUT_STRING) as Record<string, unknown> };
  return e;
}

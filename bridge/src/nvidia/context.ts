import type { ContentPart, OpenAiMessage } from './client.ts';

/** Share of the model's window at which old tool output is dropped, and at which the old conversation is summarised. */
export const SHRINK_AT = 0.6;
export const SUMMARIZE_AT = 0.8;
/** the last messages are never touched: the model is still working with them */
const KEEP_RECENT = 8;
const MAX_TOOL_RESULT = 30_000;

// shortcut: characters / 4 stands in for a tokenizer; the real prompt_tokens from the API replaces it after each call.
export function estimateTokens(messages: OpenAiMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) chars += m.content.reduce((n: number, p: ContentPart) => n + (p.type === 'text' ? p.text.length : 6000), 0);
    for (const c of m.tool_calls ?? []) chars += c.function.name.length + c.function.arguments.length;
  }
  return Math.ceil(chars / 4);
}

/** One huge file or log must not eat the window: keep the start and the end, say what was cut. */
export function capToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT) return text;
  const head = text.slice(0, 20_000);
  const tail = text.slice(-8_000);
  return `${head}\n\n[… ${text.length - 28_000} characters omitted; read a narrower range or search for what you need …]\n\n${tail}`;
}

/** Stage 1: replace the output of old tool calls by a one-line marker. Returns how many were replaced. */
export function shrinkOldToolResults(messages: OpenAiMessage[]): number {
  let n = 0;
  for (let i = 1; i < messages.length - KEEP_RECENT; i++) {
    const m = messages[i]!;
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
      m.content = `[earlier tool output omitted to save context: ${m.content.length} characters]`;
      n++;
    }
  }
  return n;
}

/**
 * Stage 2: where to cut so the old part can be summarised. Never inside a tool exchange: the cut falls on a user message,
 * otherwise an assistant tool_call would be separated from its answers. Returns -1 when there is nothing safe to cut.
 */
export function summaryCut(messages: OpenAiMessage[]): number {
  for (let i = messages.length - KEEP_RECENT; i > 1; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

export function transcriptForSummary(messages: OpenAiMessage[]): string {
  return messages
    .map((m) => {
      const body = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ') : '';
      const calls = (m.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments.slice(0, 200)})`).join('; ');
      return `${m.role.toUpperCase()}: ${body.slice(0, 1500)}${calls ? ` [calls: ${calls}]` : ''}`;
    })
    .join('\n');
}

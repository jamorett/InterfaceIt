import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamCallbacks {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
  onToolCall?: (toolCall: OpenAiToolCall) => void;
}

export interface CompletionRequest {
  model: string;
  messages: OpenAiMessage[];
  tools?: unknown[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  reasoningBudget?: number;
  seed?: number;
  enableThinking?: boolean;
  signal?: AbortSignal;
}

function loadKeyFromFiles(): string {
  const candidates = [
    join(process.cwd(), '.env'),
    join(fileURLToPath(new URL('../../../', import.meta.url)), '.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        const text = readFileSync(file, 'utf-8');
        const m = /NVIDIA_API_KEY\s*=\s*(?:["']?)(nvapi-[^"'\r\n]+)(?:["']?)/.exec(text);
        if (m && m[1] && !m[1].includes('your-key-here')) {
          const key = m[1].trim();
          process.env.NVIDIA_API_KEY = key;
          return key;
        }
      } catch {
        // continue
      }
    }
  }
  return '';
}

function resolveApiKey(provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim()) {
    return process.env.NVIDIA_API_KEY.trim();
  }
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {
      // optional
    }
  }
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim()) {
    return process.env.NVIDIA_API_KEY.trim();
  }
  return loadKeyFromFiles();
}

export class NvidiaClient {
  private baseUrl = 'https://integrate.api.nvidia.com/v1';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = resolveApiKey(apiKey);
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async streamChat(
    req: CompletionRequest,
    callbacks: StreamCallbacks
  ): Promise<{ text: string; reasoning: string; toolCalls: OpenAiToolCall[]; usage?: { promptTokens: number; completionTokens: number; /** undefined when the API does not report caching */ cachedTokens?: number }; finishReason?: string }> {
    if (!this.apiKey) {
      throw new Error('NVIDIA_API_KEY environment variable is not set. Please set it before using the NVIDIA fallback.');
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      temperature: req.temperature ?? 0.7,
      top_p: req.top_p ?? 0.95,
      max_tokens: req.max_tokens ?? 16384,
    };

    if (req.seed !== undefined) {
      body.seed = req.seed;
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.parallel_tool_calls = true;
    }

    if (req.enableThinking) {
      body.chat_template_kwargs = { enable_thinking: true };
      if (req.reasoningBudget) {
        body.reasoning_budget = req.reasoningBudget;
      }
    }

    body.stream_options = { include_usage: true };

    const res = await this.connect(JSON.stringify(body), req.signal);
    if (!res.body) {
      throw new Error('No response body returned from NVIDIA API stream.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let accumulatedText = '';
    let accumulatedReasoning = '';
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
    let buffer = '';
    let usage: { promptTokens: number; completionTokens: number; cachedTokens?: number } | undefined;
    let finishReason: string | undefined;

    while (true) {
      const { done, value } = await readOrStall(reader);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // keep-alive or comment
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr) as {
              usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null;
              choices?: Array<{
                finish_reason?: string | null;
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: {
                      name?: string;
                      arguments?: string;
                    };
                  }>;
                };
              }>;
            };

            if (data.usage) usage = { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0, cachedTokens: data.usage.prompt_tokens_details?.cached_tokens };
            const choice = data.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (!choice?.delta) continue;

            const d = choice.delta;

            // 1. Reasoning / Thinking delta
            if (d.reasoning_content) {
              accumulatedReasoning += d.reasoning_content;
              callbacks.onReasoning?.(d.reasoning_content);
            }

            // 2. Normal text content delta
            if (d.content) {
              accumulatedText += d.content;
              callbacks.onContent?.(d.content);
            }

            // 3. Tool call streaming delta
            if (d.tool_calls) {
              for (const tc of d.tool_calls) {
                const idx = tc.index ?? 0;
                let entry = pendingToolCalls.get(idx);
                if (!entry) {
                  entry = { id: tc.id ?? `call_${idx}`, name: '', args: '' };
                  pendingToolCalls.set(idx, entry);
                }
                if (tc.id) entry.id = tc.id;
                // Tool names arrive complete in the first chunk; never append to avoid "bashbash" doubling
                if (tc.function?.name && !entry.name) entry.name = tc.function.name;
                if (tc.function?.arguments) entry.args += tc.function.arguments;
              }
            }
          } catch {
            // Ignore malformed chunks
          }
        }
      }
    }

    const finalToolCalls: OpenAiToolCall[] = [];
    for (const [, tc] of pendingToolCalls) {
      if (tc.name) {
        const callObj: OpenAiToolCall = {
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.args,
          },
        };
        finalToolCalls.push(callObj);
        callbacks.onToolCall?.(callObj);
      }
    }

    return {
      text: accumulatedText,
      reasoning: accumulatedReasoning,
      toolCalls: finalToolCalls,
      usage,
      finishReason,
    };
  }

  /** POST with a few retries for what is worth retrying (network errors, 429, 5xx); a Stop or a 4xx fails at once. */
  private async connect(body: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      // some models accept the request and never answer: give up waiting for the response headers after a while
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, HEADERS_MS);
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey.trim()}` },
          body,
          signal: ctl.signal,
        });
      } catch (e) {
        if (timedOut) throw new Error(`NVIDIA did not answer within ${HEADERS_MS / 1000}s. That model may be overloaded or unavailable: try another one.`);
        if (signal?.aborted || attempt >= MAX_RETRIES) throw e;
        await sleep(backoff(attempt), signal);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        const errText = await res.text().catch(() => res.statusText);
        if (res.status === 404 || res.status === 410) {
          throw new Error(`That model is not available to your NVIDIA account (HTTP ${res.status}). Pick another one in the model selector. ${errText.slice(0, 200)}`);
        }
        throw new Error(`NVIDIA API HTTP ${res.status} error: ${errText}`);
      }
      const wait = Number(res.headers.get('retry-after'));
      await res.body?.cancel().catch(() => undefined);
      await sleep(wait > 0 ? Math.min(wait * 1000, 30_000) : backoff(attempt), signal);
    }
  }
}

const MAX_RETRIES = 3;
const HEADERS_MS = 90_000;
/** reasoning models can think a long while before the first token, so this is generous */
const STALL_MS = 120_000;

const backoff = (attempt: number) => 1000 * 2 ** attempt + Math.random() * 300;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  });
}

/** reader.read() that gives up when the stream goes silent, instead of hanging the turn forever */
function readOrStall(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout>;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => undefined); reject(new Error('NVIDIA stream stalled (no data for 2 minutes).')); }, STALL_MS);
  });
  return Promise.race([reader.read(), stall]).finally(() => clearTimeout(timer));
}


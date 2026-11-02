import { afterEach, describe, expect, it, vi } from 'vitest';
import { NvidiaClient } from './client.ts';

const sse = (...chunks: object[]) =>
  new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\n\n`)); c.close(); } }));
const ok = () => sse({ choices: [{ delta: { content: 'hi' } }] }, { choices: [{ finish_reason: 'stop', delta: {} }], usage: { prompt_tokens: 42, completion_tokens: 3 } });
const req = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }] };

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('NvidiaClient', () => {
  it('retries a 429 and a 503, then returns the text and the usage', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(ok());
    const p = new NvidiaClient('nvapi-test').streamChat(req, {});
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await p;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.text).toBe('hi');
    expect(res.usage).toEqual({ promptTokens: 42, completionTokens: 3 });
    expect(res.finishReason).toBe('stop');
  });

  describe('what is sent for thinking', () => {
    const sent = async (extra: object) => {
      vi.restoreAllMocks(); // a fresh spy (and a fresh Response, which can be read once) for every request
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
      await new NvidiaClient('nvapi-test').streamChat({ ...req, ...extra }, {});
      return JSON.parse(String(spy.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    };
    it('false really switches it off, and sends no budget', async () => {
      const b = await sent({ enableThinking: false, reasoningBudget: 8192 });
      expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(b.reasoning_budget).toBeUndefined();
    });
    it('true sends the switch and the budget (top level, which the API honours)', async () => {
      const b = await sent({ enableThinking: true, reasoningBudget: 2048 });
      expect(b.chat_template_kwargs).toEqual({ enable_thinking: true });
      expect(b.reasoning_budget).toBe(2048);
    });
    it('leaves it to the model when not told, and merges the extra kwargs a model needs', async () => {
      expect((await sent({})).chat_template_kwargs).toBeUndefined();
      expect((await sent({ enableThinking: true, templateKwargs: { force_nonempty_content: true } })).chat_template_kwargs).toEqual({ force_nonempty_content: true, enable_thinking: true });
    });
  });

  describe('a request that only ever gets keep-alives', () => {
    // a stream that sends an SSE comment every 10 s and never any data, until it is cancelled
    const keepAlives = () => {
      let timer: ReturnType<typeof setInterval>;
      return new Response(new ReadableStream({
        start(c) { timer = setInterval(() => c.enqueue(new TextEncoder().encode(': keep-alive\n\n')), 10_000); },
        cancel() { clearInterval(timer); },
      }));
    };

    it('is given up after two minutes and sent again once, instead of waiting for ever', async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => keepAlives()).mockImplementationOnce(async () => ok());
      const retries: unknown[] = [];
      const p = new NvidiaClient('nvapi-test').streamChat(req, { onRetry: (r) => retries.push(r) });
      await vi.advanceTimersByTimeAsync(130_000);
      const res = await p;
      expect(res.text).toBe('hi'); // the second try answered
      expect(retries).toHaveLength(1);
    });

    it('fails with a clear message when every try is silent', async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => keepAlives());
      const p = new NvidiaClient('nvapi-test').streamChat(req, {});
      const assertion = expect(p).rejects.toThrow('sent no content for 2 minutes');
      await vi.advanceTimersByTimeAsync(400_000);
      await assertion;
    });
  });

  it('tells the caller about each retry, so the UI can show "retrying"', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(ok());
    const retries: { attempt: number; status: number | null; delayMs: number }[] = [];
    const p = new NvidiaClient('nvapi-test').streamChat(req, { onRetry: (r) => retries.push(r) });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(retries).toEqual([expect.objectContaining({ attempt: 1, maxRetries: 3, status: 429, delayMs: 2000 })]);
  });

  it('says clearly when a model is gone, without retrying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"end of life"}', { status: 410 }));
    await expect(new NvidiaClient('nvapi-test').streamChat(req, {})).rejects.toThrow('not available to your NVIDIA account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a model that never answers is tried again twice, then reported', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = new NvidiaClient('nvapi-test').streamChat(req, {});
    const assertion = expect(p).rejects.toThrow('did not answer within 90s');
    await vi.advanceTimersByTimeAsync(3 * 91_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // the first try and two more
  });

  it('does not retry a 401', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401 }));
    await expect(new NvidiaClient('nvapi-test').streamChat(req, {})).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

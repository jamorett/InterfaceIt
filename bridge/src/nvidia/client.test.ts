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

  it('says clearly when a model is gone, without retrying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"end of life"}', { status: 410 }));
    await expect(new NvidiaClient('nvapi-test').streamChat(req, {})).rejects.toThrow('not available to your NVIDIA account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up on a model that never answers, and does not retry that', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = new NvidiaClient('nvapi-test').streamChat(req, {});
    const assertion = expect(p).rejects.toThrow('did not answer within 90s');
    await vi.advanceTimersByTimeAsync(91_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401 }));
    await expect(new NvidiaClient('nvapi-test').streamChat(req, {})).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

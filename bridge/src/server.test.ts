import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachWs, CLOSE_UNAUTHORIZED, tokenMatches } from './server.ts';

const TOKEN = 'ab'.repeat(32);
let server: Server | undefined;

async function start() {
  const s = createServer();
  server = s;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  attachWs(s, { token: TOKEN, allowedOrigins: [origin], helloTimeoutMs: 150 });
  return { url: `ws://127.0.0.1:${port}/ws`, origin };
}

// resolves with the first message, or with the close code if the socket closes first
function firstOutcome(ws: WebSocket): Promise<string | number> {
  return new Promise((resolve) => {
    ws.on('message', (d) => resolve(d.toString()));
    ws.on('close', (code) => resolve(code));
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => {});
  });
}

afterEach(
  () =>
    new Promise<void>((r) => {
      if (!server) return r();
      server.closeAllConnections();
      server.close(() => r());
      server = undefined;
    }),
);

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, 'ab')).toBe(false);
    expect(tokenMatches(TOKEN, 'cd'.repeat(32))).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
    expect(tokenMatches(TOKEN, 42)).toBe(false);
  });
});

describe('websocket handshake', () => {
  it('answers ready to a correct hello', async () => {
    const { url, origin } = await start();
    const ws = new WebSocket(url, { origin });
    const out = firstOutcome(ws);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: TOKEN })));
    expect(JSON.parse(String(await out))).toEqual({ type: 'ready' });
    ws.close();
  });

  it('closes 4401 on a wrong token', async () => {
    const { url, origin } = await start();
    const ws = new WebSocket(url, { origin });
    const out = firstOutcome(ws);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: 'cd'.repeat(32) })));
    expect(await out).toBe(CLOSE_UNAUTHORIZED);
  });

  it('closes 4401 on a first message that is not a hello', async () => {
    const { url, origin } = await start();
    const ws = new WebSocket(url, { origin });
    const out = firstOutcome(ws);
    ws.on('open', () => ws.send('not json'));
    expect(await out).toBe(CLOSE_UNAUTHORIZED);
  });

  it('closes 4401 when no hello arrives in time', async () => {
    const { url, origin } = await start();
    expect(await firstOutcome(new WebSocket(url, { origin }))).toBe(CLOSE_UNAUTHORIZED);
  });

  it('rejects a foreign Origin with 403', async () => {
    const { url } = await start();
    expect(await firstOutcome(new WebSocket(url, { origin: 'http://evil.example' }))).toBe(403);
  });

  it('rejects a missing Origin with 403', async () => {
    const { url } = await start();
    expect(await firstOutcome(new WebSocket(url))).toBe(403);
  });
});

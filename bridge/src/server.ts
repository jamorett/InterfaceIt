import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Command, UiEvent } from '@ci/shared';

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// close code the UI reads as "this link is no longer valid"
export const CLOSE_UNAUTHORIZED = 4401;

export function attachWs(server: Server, opts: { token: string; allowedOrigins: string[]; helloTimeoutMs?: number }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    // any other path is Vite's HMR socket, which has its own upgrade listener
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return;
    if (!opts.allowedOrigins.includes(req.headers.origin ?? '')) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const timer = setTimeout(() => ws.close(CLOSE_UNAUTHORIZED, 'hello timeout'), opts.helloTimeoutMs ?? 2000);
      ws.once('message', (data) => {
        clearTimeout(timer);
        let msg: Partial<Command> | undefined;
        try { msg = JSON.parse(data.toString()); } catch { /* falls through to rejection */ }
        if (msg?.type !== 'hello' || !tokenMatches(opts.token, msg.token)) {
          ws.close(CLOSE_UNAUTHORIZED, 'bad token');
          return;
        }
        ws.send(JSON.stringify({ type: 'ready' } satisfies UiEvent));
      });
    });
  });
  return wss;
}

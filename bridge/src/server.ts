import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { UiEvent } from '@ci/shared';
import { commandSchema } from '@ci/shared/commands';
import type { Connection } from './app.ts';

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// close code the UI reads as "this link is no longer valid"
export const CLOSE_UNAUTHORIZED = 4401;

type Options = {
  token: string;
  allowedOrigins: string[];
  helloTimeoutMs?: number;
  /** called once per authenticated browser; without it the server only completes the handshake */
  connect?: (send: (e: UiEvent) => void) => Connection;
};

export function attachWs(server: Server, opts: Options) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    // any other path is Vite's HMR socket, which has its own upgrade listener
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return;
    if (!opts.allowedOrigins.includes(req.headers.origin ?? '')) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => authenticate(ws, opts));
  });
  return wss;
}

function authenticate(ws: WebSocket, opts: Options) {
  const send = (e: UiEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
  };
  const timer = setTimeout(() => ws.close(CLOSE_UNAUTHORIZED, 'hello timeout'), opts.helloTimeoutMs ?? 2000);
  ws.once('message', (data) => {
    clearTimeout(timer);
    let hello: { type?: unknown; token?: unknown } | undefined;
    try { hello = JSON.parse(data.toString()); } catch { /* falls through to rejection */ }
    if (hello?.type !== 'hello' || !tokenMatches(opts.token, hello.token)) {
      ws.close(CLOSE_UNAUTHORIZED, 'bad token');
      return;
    }
    send({ type: 'ready' });
    const conn = opts.connect?.(send);
    if (!conn) return;
    ws.on('message', (raw) => {
      let json: unknown;
      try { json = JSON.parse(raw.toString()); } catch { return send({ type: 'server_error', code: 'bad_command', message: 'That message was not valid JSON.' }); }
      const parsed = commandSchema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return send({ type: 'server_error', code: 'bad_command', message: 'That command was not understood.', detail: issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : undefined });
      }
      conn.onCommand(parsed.data).catch((e) => send({ type: 'server_error', code: 'bad_command', message: e instanceof Error ? e.message : String(e) }));
    });
    ws.on('close', () => conn.onClose());
  });
}

import type { UiEvent } from '@ci/shared';
import type { Command } from '@ci/shared/commands';

export type ConnStatus = 'connecting' | 'ready' | 'reconnecting' | 'no-link';

const CLOSE_UNAUTHORIZED = 4401;

/** 0.5 s, 1 s, 2 s, 4 s, then every 5 s: a restarted bridge is found again quickly without hammering a dead one. */
export function backoff(attempt: number): number {
  return Math.min(500 * 2 ** Math.max(attempt - 1, 0), 5000);
}

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
};

export type ConnectionOptions = {
  token: string;
  url?: string;
  makeSocket?: (url: string) => Socket;
  onStatus: (status: ConnStatus, attempt: number) => void;
  /** events, grouped: one call per animation frame however many arrived, so a fast stream renders once per frame */
  onEvents: (batch: UiEvent[]) => void;
  /** after every successful handshake, first connect and each reconnect */
  onReady: () => void;
};

export function createConnection(o: ConnectionOptions) {
  const url = o.url ?? `ws://${location.host}/ws`;
  const make = o.makeSocket ?? ((u: string) => new WebSocket(u) as unknown as Socket);
  let ws: Socket | undefined;
  let attempt = 0;
  let stopped = false;
  let buffer: UiEvent[] = [];
  let flushing = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    flushing = false;
    const batch = buffer;
    buffer = [];
    if (batch.length) o.onEvents(batch);
  };
  const scheduleFlush = () => {
    if (flushing) return;
    flushing = true;
    // animation frames stop in a background tab; a timer keeps the log moving there
    if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  };

  function open() {
    const socket = make(url);
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: o.token }));
    socket.onmessage = (m) => {
      let e: UiEvent;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e.type === 'ready') {
        attempt = 0;
        o.onStatus('ready', 0);
        o.onReady();
        return;
      }
      buffer.push(e);
      scheduleFlush();
    };
    socket.onclose = (e) => {
      if (stopped || ws !== socket) return;
      if (e.code === CLOSE_UNAUTHORIZED) {
        stopped = true;
        o.onStatus('no-link', attempt);
        return;
      }
      attempt++;
      o.onStatus('reconnecting', attempt);
      retry = setTimeout(open, backoff(attempt));
    };
  }

  o.onStatus('connecting', 0);
  open();

  return {
    send(cmd: Command) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(cmd));
    },
    close() {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    },
  };
}

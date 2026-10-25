import type { Command, UiEvent } from '@ci/shared';

export type Status = 'connecting' | 'ready' | 'no-link' | 'closed';

const KEY = 'ci-token';
const CLOSE_UNAUTHORIZED = 4401;
let memoryToken: string | null = null;

// The bridge prints a link ending in #t=<token>. Keep the token, then strip it from the address bar.
export function readToken(): string | null {
  const m = /^#t=([0-9a-f]+)$/.exec(location.hash);
  if (m?.[1]) {
    memoryToken = m[1];
    history.replaceState(null, '', location.pathname + location.search);
    try { sessionStorage.setItem(KEY, m[1]); } catch { /* storage blocked: token lives for this page load only */ }
  }
  if (memoryToken) return memoryToken;
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function connect(token: string, onStatus: (s: Status) => void, onEvent: (e: UiEvent) => void): WebSocket {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  const send = (c: Command) => ws.send(JSON.stringify(c));
  ws.onopen = () => send({ type: 'hello', token });
  ws.onmessage = (m) => {
    const e = JSON.parse(String(m.data)) as UiEvent;
    if (e.type === 'ready') onStatus('ready');
    onEvent(e);
  };
  ws.onclose = (e) => onStatus(e.code === CLOSE_UNAUTHORIZED ? 'no-link' : 'closed');
  return ws;
}

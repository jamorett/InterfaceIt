import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiEvent } from '@ci/shared';
import { backoff, createConnection, type ConnStatus } from './connection.ts';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  // test helpers
  open() { this.readyState = 1; this.onopen?.({}); }
  receive(e: UiEvent) { this.onmessage?.({ data: JSON.stringify(e) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function setup() {
  const statuses: [ConnStatus, number][] = [];
  const batches: UiEvent[][] = [];
  let readies = 0;
  const conn = createConnection({
    token: 'tok', url: 'ws://test/ws', makeSocket: (u) => new FakeSocket(u) as never,
    onStatus: (s, a) => statuses.push([s, a]), onEvents: (b) => batches.push(b), onReady: () => readies++,
  });
  return { conn, statuses, batches, ready: () => readies, sock: () => FakeSocket.all.at(-1)! };
}

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; });
afterEach(() => vi.useRealTimers());

describe('backoff', () => {
  it('grows to five seconds and stays there', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(backoff)).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });
});

describe('connection', () => {
  it('says hello with the token as soon as the socket opens, and reports ready after the handshake', () => {
    const t = setup();
    t.sock().open();
    expect(JSON.parse(t.sock().sent[0]!)).toEqual({ type: 'hello', token: 'tok' });
    t.sock().receive({ type: 'ready' });
    expect(t.statuses).toEqual([['connecting', 0], ['ready', 0]]);
    expect(t.ready()).toBe(1);
  });

  it('hands over a fast stream in one batch per frame, not one render per event', () => {
    const t = setup();
    t.sock().open();
    t.sock().receive({ type: 'ready' });
    for (let i = 0; i < 100; i++) t.sock().receive({ type: 'server_error', code: 'bad_command', message: String(i) });
    expect(t.batches).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(100);
    expect(t.batches[0]![99]).toMatchObject({ message: '99' }); // order kept
  });

  it('reconnects with a growing delay, says so, and shows ready again after the handshake', () => {
    const t = setup();
    t.sock().open();
    t.sock().receive({ type: 'ready' });
    t.sock().drop();
    expect(t.statuses.at(-1)).toEqual(['reconnecting', 1]);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    t.sock().drop();
    expect(t.statuses.at(-1)).toEqual(['reconnecting', 2]);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    t.sock().open();
    t.sock().receive({ type: 'ready' });
    expect(t.statuses.at(-1)).toEqual(['ready', 0]);
    expect(t.ready()).toBe(2); // the app re-requests what it missed on every ready
  });

  it('stops for good when the link is refused (4401): a new link is needed', () => {
    const t = setup();
    t.sock().open();
    t.sock().drop(4401);
    expect(t.statuses.at(-1)![0]).toBe('no-link');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('only sends while open, and close() stops the retries', () => {
    const t = setup();
    t.conn.send({ type: 'list_sessions' });
    expect(t.sock().sent).toHaveLength(0);
    t.sock().open();
    t.conn.send({ type: 'list_sessions' });
    expect(t.sock().sent).toHaveLength(2); // hello + the command
    t.conn.close();
    t.sock().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('ignores garbage from the server', () => {
    const t = setup();
    t.sock().open();
    expect(() => t.sock().onmessage?.({ data: 'not json' })).not.toThrow();
  });
});

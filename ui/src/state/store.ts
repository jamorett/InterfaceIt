import { create } from 'zustand';
import type { Preflight, SessionEvent, SessionInfo, SessionState, UiEvent } from '@ci/shared';
import type { Command } from '@ci/shared/commands';
import type { PermissionDecision, PlanView } from '../model.ts';
import { createAnimationGate } from '../motion.ts';
import { createConnection, type ConnStatus } from './connection.ts';
import { basename } from './describe.ts';
import { notificationFor, showNotification, windowIsAway } from './notify.ts';
import { applyFull, initialView, recordAnswer, reduce, type SessionView } from './reduce.ts';

const gate = createAnimationGate();
let connection: ReturnType<typeof createConnection> | undefined;

const isSessionEvent = (e: UiEvent): e is SessionEvent => 'seq' in e;
// Which sessions this browser tab had open: kept per tab, so a reload re-attaches them but a new tab starts clean
const OPEN_KEY = 'ci-open';
const savedOpen = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '[]') as string[]; } catch { return []; }
};
const saveOpen = (ids: string[]) => {
  try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* a reload then starts at the project list: nothing is lost, the sessions keep running */ }
};
const remember = (cwd: string) => {
  try { localStorage.setItem('ci-last-project', cwd); } catch { /* storage blocked: only the shortcut is lost */ }
};

export type Store = {
  conn: ConnStatus;
  attempt: number;
  everReady: boolean;
  preflight?: Preflight;
  past: SessionInfo[];
  views: Record<string, SessionView>;
  /** sessions this browser has open, in the order they were opened */
  order: string[];
  activeId?: string;
  /** a folder that needs the user's "do you trust this?" before a session can start in it */
  trusting?: string;
  starting: boolean;
  notice?: string;
  /** the usage-limit warning the user closed, by its reset time */
  dismissedLimit?: number;
  /** latest answer to an "@" file search */
  files?: { query: string; paths: string[] };
  debug: boolean;

  connect(token: string): void;
  apply(batch: UiEvent[]): void;
  send(cmd: Command): void;

  checkAgain(): void;
  start(cwd: string): void;
  trustAndStart(): void;
  cancelTrust(): void;
  select(id: string): void;
  newSession(): void;
  /** end a session in the bridge and drop it from this tab; its conversation stays on disk */
  closeSession(id: string): void;
  openPast(info: SessionInfo): void;
  /** take over a session the bridge is running (started in another tab, or before a reload) */
  attachLive(info: SessionInfo): void;
  resumeCrashed(): void;
  dismissLimit(resetsAt: number): void;

  prompt(text: string, images?: { mediaType: string; data: string }[]): void;
  searchFiles(query: string): void;
  stop(): void;
  unqueue(id: string): void;
  decide(reqId: string, d: PermissionDecision, reason?: string, edited?: Record<string, string>): void;
  answer(viewId: string, labels: string[]): void;
  fetchFull(toolId: string): void;
  decidePlan(reqId: string, d: NonNullable<PlanView['decision']>, feedback?: string): void;
  setMode(mode: Extract<Command, { type: 'set_mode' }>['mode']): void;
  setModel(model: string): void;
};

export const useStore = create<Store>()((set, get) => {
  const active = () => get().activeId;
  const sendTo = (build: (sessionId: string) => Command) => {
    const id = active();
    if (id) get().send(build(id));
  };

  return {
    conn: 'connecting', attempt: 0, everReady: false, past: [], views: {}, order: [], starting: false,
    debug: new URLSearchParams(location.search).has('debug'),

    connect(token) {
      connection?.close();
      connection = createConnection({
        token,
        onStatus: (conn, attempt) => set((s) => ({ conn, attempt, everReady: s.everReady || conn === 'ready' })),
        onEvents: (batch) => get().apply(batch),
        onReady: () => {
          const s = get();
          s.send({ type: 'preflight' });
          s.send({ type: 'list_sessions' });
          // ask for whatever each open session produced while we were away
          for (const id of s.order) s.send({ type: 'replay_from', sessionId: id, seq: s.views[id]?.lastSeq ?? 0 });
        },
      });
    },

    send: (cmd) => connection?.send(cmd),

    apply(batch) {
      const reattach: string[] = [];
      const before: Record<string, SessionState | undefined> = {};
      for (const e of batch) if (isSessionEvent(e) && !(e.sessionId in before)) before[e.sessionId] = get().views[e.sessionId]?.state;
      set((s) => {
        const next = { views: s.views, order: s.order, activeId: s.activeId, past: s.past, preflight: s.preflight, trusting: s.trusting, starting: s.starting, notice: s.notice, files: s.files };
        for (const e of batch) {
          if (isSessionEvent(e)) {
            const view = next.views[e.sessionId] ?? initialView(e.sessionId, '');
            // history and old events never animate; neither does the 11th card of a burst (motion.ts)
            const instant = !gate({ kind: e.type, ts: e.ts, replayed: e.replayed });
            next.views = { ...next.views, [e.sessionId]: reduce(view, e, instant) };
            continue;
          }
          switch (e.type) {
            case 'preflight': next.preflight = e.preflight; break;
            case 'fs_results': next.files = { query: e.query, paths: e.paths }; break;
            case 'tool_full': {
              const v = next.views[e.sessionId];
              if (v) next.views = { ...next.views, [e.sessionId]: applyFull(v, e.toolId, e.text) };
              break;
            }
            case 'session_list':
              next.past = e.sessions;
              // sessions this tab had open before a reload are still running in the bridge: take them back with their full history
              for (const info of e.sessions) {
                if (!info.live || next.views[info.id] || !savedOpen().includes(info.id)) continue;
                next.views = { ...next.views, [info.id]: initialView(info.id, info.cwd) };
                next.order = [...next.order, info.id];
                next.activeId ??= info.id;
                reattach.push(info.id);
              }
              break;
            case 'session_opened':
              next.views = { ...next.views, [e.sessionId]: next.views[e.sessionId] ?? initialView(e.sessionId, e.cwd) };
              if (!next.order.includes(e.sessionId)) next.order = [...next.order, e.sessionId];
              next.activeId = e.sessionId;
              next.trusting = undefined;
              next.starting = false;
              next.notice = undefined;
              remember(e.cwd);
              break;
            case 'server_error':
              next.starting = false;
              if (e.code === 'untrusted_folder') next.trusting = e.detail;
              else if (e.code === 'unknown_session' && e.detail && next.views[e.detail]) {
                // the bridge was restarted: the conversation is stored on disk, so it can be resumed
                next.views = { ...next.views, [e.detail]: { ...next.views[e.detail]!, state: 'ended', crashed: 'The bridge was restarted, so this session is no longer running.' } };
              } else next.notice = e.detail ? `${e.message} (${e.detail})` : e.message;
              break;
          }
        }
        return next;
      });
      for (const id of reattach) get().send({ type: 'replay_from', sessionId: id, seq: 0 });
      saveOpen(get().order);
      // a pop-up only when the window is out of sight, and never for history being replayed
      if (windowIsAway()) {
        for (const [id, prev] of Object.entries(before)) {
          const view = get().views[id];
          if (!view || batch.some((e) => isSessionEvent(e) && e.sessionId === id && e.replayed)) continue;
          const note = notificationFor(prev, view.state, basename(view.cwd) || 'ClaudeInterface');
          if (note) showNotification(note, id);
        }
      }
    },

    checkAgain: () => get().send({ type: 'preflight' }),

    start(cwd) {
      set({ starting: true, notice: undefined });
      get().send({ type: 'start', cwd });
    },
    trustAndStart() {
      const cwd = get().trusting;
      if (!cwd) return;
      get().send({ type: 'trust_folder', path: cwd });
      get().start(cwd);
    },
    cancelTrust: () => set({ trusting: undefined }),
    select: (id) => set({ activeId: id }),
    newSession: () => set({ activeId: undefined }),
    closeSession(id) {
      get().send({ type: 'close', sessionId: id });
      set((s) => {
        const { [id]: _gone, ...views } = s.views;
        const order = s.order.filter((x) => x !== id);
        return { views, order, past: s.past.map((p) => (p.id === id ? { ...p, live: false } : p)), activeId: s.activeId === id ? order.at(-1) : s.activeId };
      });
      saveOpen(get().order);
      get().send({ type: 'list_sessions' });
    },
    openPast(info) {
      const live = Object.values(get().views).find((v) => v.id === info.id || v.init?.sdkSessionId === info.id);
      if (live) return set({ activeId: live.id });
      set({ starting: true });
      get().send({ type: 'resume', sdkSessionId: info.id, cwd: info.cwd });
    },
    attachLive(info) {
      set((s) => ({
        views: { ...s.views, [info.id]: s.views[info.id] ?? initialView(info.id, info.cwd) },
        order: s.order.includes(info.id) ? s.order : [...s.order, info.id],
        activeId: info.id,
      }));
      saveOpen(get().order);
      get().send({ type: 'replay_from', sessionId: info.id, seq: get().views[info.id]?.lastSeq ?? 0 });
    },
    resumeCrashed() {
      const v = get().views[active() ?? ''];
      if (v) get().send({ type: 'resume', sdkSessionId: v.init?.sdkSessionId ?? v.id, cwd: v.cwd });
    },
    dismissLimit: (resetsAt) => set({ dismissedLimit: resetsAt }),

    prompt: (text, images) => sendTo((sessionId) => ({ type: 'prompt', sessionId, text, ...(images?.length && { images: images as never }) })),
    searchFiles: (query) => sendTo((sessionId) => ({ type: 'fs_search', sessionId, query })),
    stop: () => sendTo((sessionId) => ({ type: 'interrupt', sessionId })),
    unqueue: (promptId) => sendTo((sessionId) => ({ type: 'unqueue', sessionId, promptId })),
    decide(reqId, d, reason, edited) {
      sendTo((sessionId) =>
        d === 'denied' || d === 'cancelled'
          ? { type: 'permission_reply', sessionId, reqId, decision: 'deny', reason }
          : { type: 'permission_reply', sessionId, reqId, decision: 'allow', editedInput: edited, scope: ({ 'allowed-once': 'once', 'allowed-session': 'session', 'allowed-local': 'local', 'allowed-project': 'project', 'allowed-user': 'user' } as const)[d] },
      );
    },
    answer(viewId, labels) {
      const id = active();
      const view = id ? get().views[id] : undefined;
      if (!id || !view) return;
      const r = recordAnswer(view, viewId, labels);
      set((s) => ({ views: { ...s.views, [id]: r.view } }));
      if (r.complete) get().send({ type: 'answer', sessionId: id, reqId: r.complete.reqId, answers: r.complete.answers });
    },
    fetchFull: (toolId) => sendTo((sessionId) => ({ type: 'fetch_full', sessionId, toolId })),
    decidePlan(reqId, d, feedback) {
      sendTo((sessionId) => ({ type: 'plan_reply', sessionId, reqId, decision: d === 'approved-auto' ? 'approve_auto' : d === 'approved-manual' ? 'approve_manual' : 'reject', feedback }));
    },
    setMode: (mode) => sendTo((sessionId) => ({ type: 'set_mode', sessionId, mode })),
    setModel: (model) => sendTo((sessionId) => ({ type: 'set_model', sessionId, model })),
  };
});

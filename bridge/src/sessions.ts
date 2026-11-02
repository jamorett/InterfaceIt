import { randomUUID } from 'node:crypto';
import { isNvidiaModel, type PermissionMode, type SessionEvent, type SessionInfo } from '@ci/shared';
import { SessionCore, type SessionLike } from './core.ts';
import { createNormalizer } from './normalize.ts';
import { SdkSession, type SessionSpec } from './session.ts';
import { NvidiaSession } from './nvidia/session.ts';
import { DEFAULT_NVIDIA_MODEL } from './nvidia/models.ts';

type Seedable = SessionLike & { seedHistory(bodies: ReturnType<ReturnType<typeof createNormalizer>['push']>): void };

/** The mode and extra folders the user had when a session is handed to the other provider: the last session_init / status in its log. */
export function settingsFromLog(events: SessionEvent[]): { mode?: PermissionMode; addDirs?: string[] } {
  let mode: PermissionMode | undefined;
  let addDirs: string[] | undefined;
  for (const e of events) {
    if (e.type === 'session_init') { mode = e.mode; addDirs = e.addDirs; }
    else if (e.type === 'status' && e.mode) mode = e.mode;
  }
  return { mode, addDirs };
}

export type Factory =(spec: SessionSpec, id: string) => SessionLike;
export type HistoryLoader = (sdkSessionId: string, cwd: string) => Promise<unknown[]>;

/** Sessions live here, not in the browser tab: closing the tab does not stop a running turn (PLAN.md §1). */
export class SessionManager {
  private sessions = new Map<string, SessionLike>();

  constructor(private create: Factory, private loadHistory: HistoryLoader) {}

  get(id: string): SessionLike | undefined {
    return this.sessions.get(id);
  }

  async open(spec: SessionSpec): Promise<{ session: SessionLike; resumed: boolean }> {
    const resume = spec.resume;
    if (resume && !resume.fork) {
      const live = this.sessions.get(resume.sdkSessionId);
      if (live) return { session: live, resumed: true };
    }
    // the stored conversation first, so it is in the log before the first live event
    const history = resume ? await this.loadHistory(resume.sdkSessionId, spec.cwd).catch(() => []) : [];
    const id = resume && !resume.fork ? resume.sdkSessionId : randomUUID();

    // Check if NVIDIA provider was explicitly requested or inferred from model
    const useNvidia = spec.provider === 'nvidia' || (spec.model !== undefined && isNvidiaModel(spec.model));
    const session = useNvidia ? new NvidiaSession(spec, id) : this.create(spec, id);

    if (session instanceof SdkSession) {
      session.onRateLimitRejected = (sid) => {
        void this.handoffToNvidia(sid);
      };
    }

    if (history.length) {
      const n = createNormalizer('history');
      (session as Seedable).seedHistory?.(history.flatMap((m) => n.push(m)));
    }
    this.sessions.set(id, session);
    return { session, resumed: Boolean(resume) };
  }

  handoffToNvidia(id: string, model: string = DEFAULT_NVIDIA_MODEL): SessionLike | undefined {
    const current = this.sessions.get(id);
    if (!current) return undefined;

    if (current instanceof NvidiaSession) {
      void current.setModel(model);
      return current;
    }

    const events = current.log.all ? current.log.all() : current.log.after(0);
    const cwd = current.cwd;
    const existingLog = current.log;
    const { mode, addDirs } = settingsFromLog(events);

    // a question still open in the old session would never be answered
    if (current instanceof SessionCore) current.cancelPending();
    // Detach current without emitting session_ended to the UI
    if ('detach' in current && typeof (current as { detach: unknown }).detach === 'function') {
      (current as { detach: () => void }).detach();
    } else {
      current.close();
    }

    const nvidia = new NvidiaSession({ cwd, model, mode, addDirs }, id, existingLog);
    if (events.length) {
      nvidia.handoffFromEvents(events);
    }

    if (current instanceof SessionCore) {
      current.transferListeners(nvidia);
    }

    this.sessions.set(id, nvidia);

    // Announce the transition in transcript
    nvidia.announceNotice(`Session switched to NVIDIA NIM fallback (${model}).`);

    return nvidia;
  }

  handoffToClaude(id: string, model?: string): SessionLike | undefined {
    const current = this.sessions.get(id);
    if (!current) return undefined;

    if (current instanceof SdkSession) {
      if (model) void current.setModel(model);
      return current;
    }

    const cwd = current.cwd;
    const { mode, addDirs } = settingsFromLog(current.log.after(0));

    if (current instanceof SessionCore) current.cancelPending();
    // Detach current without emitting session_ended to the UI
    if ('detach' in current && typeof (current as { detach: unknown }).detach === 'function') {
      (current as { detach: () => void }).detach();
    } else {
      current.close();
    }

    const claude = this.create({ cwd, model: model && !isNvidiaModel(model) ? model : undefined, provider: 'claude', mode, addDirs }, id);
    if (claude instanceof SdkSession) {
      claude.onRateLimitRejected = (sid) => {
        void this.handoffToNvidia(sid);
      };
    }

    if (current instanceof SessionCore && claude instanceof SessionCore) {
      current.transferListeners(claude);
    }

    this.sessions.set(id, claude);
    return claude;
  }

  close(id: string): void {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  live(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info());
  }
}

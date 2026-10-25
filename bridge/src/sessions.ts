import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '@ci/shared';
import type { SessionLike } from './core.ts';
import { createNormalizer } from './normalize.ts';
import type { SessionSpec } from './session.ts';

type Seedable = SessionLike & { seedHistory(bodies: ReturnType<ReturnType<typeof createNormalizer>['push']>): void };

export type Factory = (spec: SessionSpec, id: string) => SessionLike;
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
    const session = this.create(spec, id);
    if (history.length) {
      const n = createNormalizer('history');
      (session as Seedable).seedHistory?.(history.flatMap((m) => n.push(m)));
    }
    this.sessions.set(id, session);
    return { session, resumed: Boolean(resume) };
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

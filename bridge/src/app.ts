// Routes each validated command from a browser to the right session, and each session's events back to the browser.
import { statSync } from 'node:fs';
import type { Preflight, ServerEvent, SessionInfo, UiEvent } from '@ci/shared';
import type { Command } from '@ci/shared/commands';
import { forWire } from './eventlog.ts';
import type { SessionManager } from './sessions.ts';

export type Deps = {
  manager: SessionManager;
  preflight: () => Promise<Preflight>;
  listPast: () => Promise<SessionInfo[]>;
  isTrusted: (cwd: string) => boolean;
  trust: (cwd: string) => void;
  isFolder?: (path: string) => boolean;
};

const defaultIsFolder = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export type Connection = { onCommand(cmd: Command): Promise<void>; onClose(): void };

export function createApp(deps: Deps) {
  const isFolder = deps.isFolder ?? defaultIsFolder;

  return function connect(send: (e: UiEvent) => void): Connection {
    const subscriptions = new Map<string, () => void>();
    const fail = (code: Extract<ServerEvent, { type: 'server_error' }>['code'], message: string, detail?: string) => send({ type: 'server_error', code, message, detail });

    /** Replay what the browser has not seen yet, then follow the session live. Both happen in one tick, so no event falls between. */
    function attach(sessionId: string, afterSeq: number) {
      const session = deps.manager.get(sessionId);
      if (!session) return fail('unknown_session', 'That session is not open.', sessionId);
      subscriptions.get(sessionId)?.();
      for (const e of session.log.after(afterSeq)) send(forWire(e));
      subscriptions.set(sessionId, session.subscribe((e) => send(forWire(e))));
    }

    async function open(cwd: string, spec: Parameters<SessionManager['open']>[0]) {
      if (!isFolder(cwd)) return fail('not_a_folder', 'That folder does not exist.', cwd);
      if (!deps.isTrusted(cwd)) return fail('untrusted_folder', 'Do you trust this folder?', cwd);
      try {
        const { session, resumed } = await deps.manager.open(spec);
        send({ type: 'session_opened', sessionId: session.id, cwd, resumed });
        attach(session.id, 0);
      } catch (e) {
        fail('start_failed', e instanceof Error ? e.message : String(e));
      }
    }

    const session = (id: string) => {
      const s = deps.manager.get(id);
      if (!s) fail('unknown_session', 'That session is not open.', id);
      return s;
    };

    return {
      async onCommand(cmd) {
        switch (cmd.type) {
          case 'hello': return; // the handshake already happened
          case 'preflight': return send({ type: 'preflight', preflight: await deps.preflight() });
          case 'list_sessions': {
            const live = deps.manager.live();
            const known = new Set(live.flatMap((s) => [s.id, s.sdkId ?? s.id]));
            return send({ type: 'session_list', sessions: [...live, ...(await deps.listPast().catch(() => [])).filter((s) => !known.has(s.id))] });
          }
          case 'trust_folder':
            if (!isFolder(cmd.path)) return fail('not_a_folder', 'That folder does not exist.', cmd.path);
            return deps.trust(cmd.path);
          case 'start':
            return open(cmd.cwd, { cwd: cmd.cwd, model: cmd.model, effort: cmd.effort, mode: cmd.mode as never, addDirs: cmd.addDirs });
          case 'resume':
            return open(cmd.cwd, { cwd: cmd.cwd, resume: { sdkSessionId: cmd.sdkSessionId, fork: cmd.fork } });
          case 'close':
            subscriptions.get(cmd.sessionId)?.();
            subscriptions.delete(cmd.sessionId);
            return deps.manager.close(cmd.sessionId);
          case 'replay_from': return attach(cmd.sessionId, cmd.seq);
          case 'prompt': return session(cmd.sessionId)?.prompt(cmd.text);
          case 'unqueue': return session(cmd.sessionId)?.unqueue(cmd.promptId);
          case 'interrupt': return session(cmd.sessionId)?.interrupt();
          case 'permission_reply': return session(cmd.sessionId)?.permissionReply(cmd.reqId, cmd.decision, cmd.scope, cmd.reason, cmd.editedInput);
          case 'answer': return session(cmd.sessionId)?.answer(cmd.reqId, cmd.answers);
          case 'plan_reply': return session(cmd.sessionId)?.planReply(cmd.reqId, cmd.decision, cmd.feedback);
          case 'set_mode': return session(cmd.sessionId)?.setMode(cmd.mode as never);
          case 'set_model': return session(cmd.sessionId)?.setModel(cmd.model);
          case 'set_effort': return session(cmd.sessionId)?.setEffort(cmd.effort);
        }
      },
      onClose() {
        // sessions keep running without a browser; only this browser's subscriptions end
        for (const unsub of subscriptions.values()) unsub();
        subscriptions.clear();
      },
    };
  };
}

// A live conversation with Claude Code through the Agent SDK. One `query()` per session (PLAN.md §4 rule 4).
import { randomUUID } from 'node:crypto';
import { query, type CanUseTool, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Effort, PermissionMode } from '@ci/shared';
import { SessionCore, type Decision } from './core.ts';
import { createNormalizer, modelsEvent, permissionEvent, usageEvent } from './normalize.ts';
import { Pushable } from './pushable.ts';

export type SessionSpec = {
  cwd: string;
  model?: string;
  effort?: Effort;
  mode?: PermissionMode;
  addDirs?: string[];
  /** continue (or, with `fork`, copy) a conversation stored on disk */
  resume?: { sdkSessionId: string; fork?: boolean };
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class SdkSession extends SessionCore {
  private input = new Pushable<SDKUserMessage>();
  private q: Query;
  private normalizer = createNormalizer('live');
  private modelsSent = false;

  constructor(spec: SessionSpec, id: string = randomUUID()) {
    super(id, spec.cwd);
    const canUseTool: CanUseTool = (tool, input, o) => {
      const event = permissionEvent(tool, input, o);
      if (event.type !== 'permission_request' && event.type !== 'question' && event.type !== 'plan') return Promise.resolve({ behavior: 'deny', message: 'Unsupported request.' });
      o.signal.addEventListener('abort', () => this.abandon(event.reqId), { once: true });
      return this.request(event, tool, input, o.suggestions) as Promise<Awaited<ReturnType<CanUseTool>>>;
    };
    const options: Options = {
      cwd: spec.cwd,
      ...(spec.model && spec.model !== 'default' && { model: spec.model }),
      ...(spec.effort && { effort: spec.effort }),
      ...(spec.mode && { permissionMode: spec.mode }),
      ...(spec.addDirs?.length && { additionalDirectories: spec.addDirs }),
      allowDangerouslySkipPermissions: process.env.CLAUDEINTERFACE_ALLOW_BYPASS === '1',
      // settingSources is left out on purpose: the user's CLAUDE.md, hooks, skills and permissions load exactly as in the CLI
      includePartialMessages: true,
      includeHookEvents: true,
      forwardSubagentText: true,
      promptSuggestions: true,
      enableFileCheckpointing: true,
      canUseTool,
      // M4 shows these; until then they are answered safely instead of left hanging
      onElicitation: async (r) => {
        this.ingest([{ type: 'notice', level: 'warning', text: `${r.serverName} asked for input this version cannot show, so it was declined.` }]);
        return { action: 'decline' };
      },
      onUserDialog: async () => ({ behavior: 'cancelled' }),
      // `env` replaces the child's environment, so process.env must be spread back in
      env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', CLAUDE_AGENT_SDK_CLIENT_APP: 'claudeinterface/0.0.0' },
      ...(spec.resume ? { resume: spec.resume.sdkSessionId, forkSession: spec.resume.fork === true } : { sessionId: id }),
    };
    this.q = query({ prompt: this.input, options });
    void this.loop();
  }

  private async loop() {
    try {
      for await (const msg of this.q) {
        const bodies = this.normalizer.push(msg);
        this.ingest(bodies);
        if (bodies.some((b) => b.type === 'session_init') && !this.modelsSent) void this.sendModels();
        if (bodies.some((b) => b.type === 'sdk_state' && b.state === 'idle')) void this.refreshUsage();
      }
      this.finish('finished');
    } catch (e) {
      if (this.ended) return;
      this.ingest([{ type: 'error', code: 'sdk_failed', message: messageOf(e), recoverable: false }]);
      this.finish('error');
    }
  }

  private finish(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.ingest([{ type: 'session_ended', reason }]);
  }

  private async sendModels() {
    this.modelsSent = true;
    try {
      const e = modelsEvent(await this.q.supportedModels());
      if (e) this.ingest([e]);
    } catch { /* the header just keeps its default list */ }
  }

  private async refreshUsage() {
    try {
      const e = usageEvent(await this.q.getContextUsage({ detail: 'summary' }));
      if (e) this.ingest([e]);
    } catch { /* the gauge keeps its last value */ }
  }

  protected deliver(id: string, text: string): void {
    this.input.push({ type: 'user', uuid: id, message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage);
  }

  protected async stop(): Promise<void> {
    await this.q.interrupt().catch(() => undefined);
  }

  async setMode(mode: PermissionMode): Promise<void> {
    await this.q.setPermissionMode(mode);
  }

  async setModel(model: string): Promise<void> {
    await this.q.setModel(model === 'default' ? undefined : model);
  }

  async setEffort(effort: Effort): Promise<void> {
    await this.q.applyFlagSettings({ effortLevel: effort });
  }

  close(): void {
    this.finish('closed');
    this.input.end();
    this.q.close();
  }
}

export type { Decision };

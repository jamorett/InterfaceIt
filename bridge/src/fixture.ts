// A session that replays recorded real messages (bridge/test/fixtures) instead of calling the SDK, started with `--fake`.
// UI tests run against it, so they never spend usage, yet exercise the whole path: WebSocket, normalizer, state, queue, requests.
// Put [[scenario]] in a prompt to choose the recording (default: basic).
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Effort, PermissionMode } from '@ci/shared';
import { SessionCore } from './core.ts';
import { createNormalizer, modelsEvent, permissionEvent } from './normalize.ts';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fixtureLines = (name: string): Record<string, any>[] | undefined =>
  /^[\w-]+$/.test(name) && existsSync(`${dir}${name}.jsonl`) ? readFileSync(`${dir}${name}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : undefined;

export class FixtureSession extends SessionCore {
  private cancelled = false;

  constructor(cwd: string, id: string = randomUUID(), private stepMs = 3) {
    super(id, cwd);
    try {
      const models = modelsEvent(JSON.parse(readFileSync(`${dir}basic.notes.json`, 'utf8')).methods.supportedModels);
      if (models) this.ingest([models]);
    } catch { /* no recorded model list: the UI keeps its defaults */ }
    this.ingest([{ type: 'commands', commands: [{ name: 'review', description: 'Review the pending changes' }, { name: 'compact', description: 'Free up context', hint: '[focus]' }, { name: 'rewind', description: 'Go back to an earlier point' }] }]);
  }

  protected deliver(_id: string, text: string, _images?: unknown): void {
    void this.play(/\[\[([\w-]+)\]\]/.exec(text)?.[1] ?? 'basic');
  }

  private async play(name: string) {
    const lines = fixtureLines(name);
    if (!lines) {
      this.ingest([{ type: 'error', code: 'no_fixture', message: `No recording called "${name}".`, recoverable: true }, { type: 'sdk_state', state: 'running' }, { type: 'sdk_state', state: 'idle' }]);
      return;
    }
    this.cancelled = false;
    const norm = createNormalizer('live');
    for (const m of lines) {
      if (this.cancelled || this.ended) break;
      if (m.type === 'probe_permission_request') {
        const event = permissionEvent(m.tool, m.input, m.options);
        if (event.type === 'permission_request' || event.type === 'question' || event.type === 'plan') await this.request(event, m.tool, m.input, m.options?.suggestions);
        continue;
      }
      if (String(m.type).startsWith('probe_')) continue;
      this.ingest(norm.push(m));
      await sleep(m.type === 'stream_event' ? this.stepMs : this.stepMs * 4);
    }
    if (this.cancelled && !this.ended) {
      this.ingest([{ type: 'result', ok: false, stopped: true, terminalReason: 'aborted_tools', costUsd: 0, durationMs: 0, turns: 0, denials: 0 }]);
      if (this.tracker.busy) this.ingest([{ type: 'sdk_state', state: 'idle' }]);
    }
  }

  protected async stop(): Promise<void> {
    this.cancelled = true;
  }

  async setMode(mode: PermissionMode): Promise<void> {
    this.ingest([{ type: 'status', compacting: false, mode }]);
  }
  async setModel(): Promise<void> {}
  async setEffort(_effort: Effort): Promise<void> {}

  close(): void {
    this.cancelled = true;
    if (this.ended) return;
    this.ended = true;
    this.ingest([{ type: 'session_ended', reason: 'closed' }]);
  }
}

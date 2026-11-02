// End-to-end check of the NVIDIA fallback against the REAL API: a session in a throwaway folder reads a file, asks permission
// before writing one, and reports its context usage. It spends a few thousand tokens of the NVIDIA key.
// Usage: npm run smoke:nvidia        (exit code 0 = everything held, 1 = something did not)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '@ci/shared';
import { NvidiaClient } from '../src/nvidia/client.ts';
import { NvidiaSession } from '../src/nvidia/session.ts';

if (!new NvidiaClient().isConfigured) {
  console.log('SKIP  no NVIDIA_API_KEY (set it in the environment or in .env)');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'ci-smoke-nvidia-'));
writeFileSync(join(dir, 'hello.txt'), 'hello world\n');

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const session = new NvidiaSession({ cwd: dir, mode: 'default' });
const events: SessionEvent[] = [];
session.subscribe((e) => events.push(e));

/** Send a prompt and wait for the turn to end, answering permission requests with `onPermission`. */
async function turn(text: string, onPermission: (tool: string, reqId: string) => void, ms = 180_000): Promise<SessionEvent[]> {
  const from = events.length;
  const seen = new Set<string>();
  session.prompt(text);
  const start = Date.now();
  for (;;) {
    const mine = events.slice(from);
    for (const e of mine) {
      if (e.type === 'permission_request' && !seen.has(e.reqId)) { seen.add(e.reqId); onPermission(e.tool, e.reqId); }
    }
    const started = mine.some((e) => e.type === 'sdk_state' && e.state === 'running');
    if (started && mine.some((e) => e.type === 'sdk_state' && e.state === 'idle')) return mine;
    if (Date.now() - start > ms) throw new Error('the turn did not finish in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

try {
  // 1. a read is free in Manual mode, and the answer comes from the file
  const t1 = await turn('Read hello.txt with your read tool and reply with the second word in it, nothing else.', () => check('a read does not ask', false));
  const text1 = t1.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('');
  check('read_file ran', t1.some((e) => e.type === 'tool_start' && e.name === 'read_file'));
  check('the answer used the file', /world/i.test(text1), text1.slice(0, 60));
  check('no permission card for a read', !t1.some((e) => e.type === 'permission_request'));
  check('the context gauge got real usage', events.some((e) => e.type === 'usage' && e.totalTokens > 0));

  // 2. a write asks first, and runs once allowed
  let asked = '';
  const t2 = await turn('Create a file named out.txt in the current folder containing exactly the text: ok', (tool, reqId) => {
    asked = tool;
    session.permissionReply(reqId, 'allow');
  });
  check('a write asked first', asked === 'write_file' || asked === 'bash', asked);
  check('the file was written after allowing', existsSync(join(dir, 'out.txt')) && /ok/.test(readFileSync(join(dir, 'out.txt'), 'utf-8')));
  check('the turn ended with a result', t2.some((e) => e.type === 'result' && e.ok));

  // 3. plan mode refuses a write without asking
  await session.setMode('plan');
  const t3 = await turn('Create a file named nope.txt containing: no. If you cannot, say so in one sentence.', (tool, reqId) => {
    if (tool === 'exit_plan') return;
    session.permissionReply(reqId, 'deny');
  });
  check('plan mode wrote nothing', !existsSync(join(dir, 'nope.txt')));
  check('plan mode did not ask to write', !t3.some((e) => e.type === 'permission_request'));
} catch (e) {
  check('smoke run', false, e instanceof Error ? e.message : String(e));
} finally {
  session.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

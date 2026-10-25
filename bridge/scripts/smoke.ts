// End-to-end check of the REAL path: browser protocol → bridge → Agent SDK → Claude Code → back.
// It plays the browser's part over the WebSocket against a throwaway folder and spends a few cents of the logged-in account's usage.
// Usage: npm run smoke        (exit code 0 = everything held, 1 = something did not)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteSession } from '@anthropic-ai/claude-agent-sdk';
import WebSocket from 'ws';
import type { UiEvent } from '@ci/shared';
import type { Command } from '@ci/shared/commands';

const PORT = '4330';
const TOKEN = 'cd'.repeat(32);
const dir = mkdtempSync(join(tmpdir(), 'ci-smoke-'));
writeFileSync(join(dir, 'hello.txt'), 'hello world\n');

const bridge = spawn(process.execPath, ['--import', 'tsx', 'bridge/src/main.ts', '--no-open'], {
  env: { ...process.env, CLAUDEINTERFACE_PORT: PORT, CLAUDEINTERFACE_TOKEN: TOKEN, CLAUDEINTERFACE_TRUST_FILE: join(dir, 'trusted.json') },
  stdio: 'ignore',
});

const events: UiEvent[] = [];
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T extends UiEvent>(pred: (e: UiEvent) => e is T, ms = 90_000, from = 0): Promise<T> {
  const start = Date.now();
  for (;;) {
    const hit = events.slice(from).find(pred);
    if (hit) return hit;
    if (Date.now() - start > ms) throw new Error('timed out waiting for an event');
    await sleep(50);
  }
}
const is = <K extends string>(type: K, extra?: (e: any) => boolean) => (e: UiEvent): e is Extract<UiEvent, { type: K }> => e.type === type && (!extra || extra(e));

let ws!: WebSocket;
let sessionId: string | undefined;
const send = (c: Command) => ws.send(JSON.stringify(c));
const mark = () => events.length;

async function connect() {
  for (let i = 0; i < 150; i++) {
    try {
      ws = await new Promise<WebSocket>((res, rej) => {
        const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: `http://127.0.0.1:${PORT}` });
        s.once('open', () => res(s));
        s.once('error', rej);
      });
      break;
    } catch { await sleep(200); }
  }
  if (!ws!) throw new Error('the bridge did not start');
  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  send({ type: 'hello', token: TOKEN });
  await waitFor(is('ready'), 5000);
}

/** one prompt, answered: waits for the turn's result and for the session to be idle again */
async function turn(sessionId: string, text: string, onEvent?: (from: number) => Promise<void>) {
  const from = mark();
  send({ type: 'prompt', sessionId, text });
  if (onEvent) await onEvent(from);
  const result = await waitFor(is('result'), 120_000, from);
  await waitFor(is('session_state', (e) => e.state === 'idle' && e.seq > result.seq && e.sessionId === sessionId), 60_000, from);
  return { from, result };
}
const textSince = (from: number) =>
  events.slice(from).flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

try {
  await connect();
  check('handshake with the one-time token', true);

  send({ type: 'preflight' });
  const pre = await waitFor(is('preflight'), 40_000);
  check('preflight: Claude Code can run and you are signed in', pre.preflight.cliFound && pre.preflight.loggedIn, `v${pre.preflight.cliVersion}, ${pre.preflight.subscriptionType ?? pre.preflight.authMethod}`);
  check('preflight never contains the email or organisation', !/[w.+-]+@[w-]+.[w.-]+|"email"|orgName|orgId|"organization"/.test(JSON.stringify(pre)));
  check('the login hint is the plain command when claude is on PATH', pre.preflight.loginCommand === 'claude auth login', pre.preflight.loginCommand);

  send({ type: 'start', cwd: dir, model: 'haiku', effort: 'low' });
  const untrusted = await waitFor(is('server_error', (e) => e.code === 'untrusted_folder'), 10_000);
  check('an unknown folder asks for trust first', untrusted.detail === dir);
  send({ type: 'trust_folder', path: dir });
  send({ type: 'start', cwd: dir, model: 'haiku', effort: 'low' });
  const opened = await waitFor(is('session_opened'), 10_000);
  const sid = opened.sessionId;
  sessionId = sid;
  check('session opens after trusting', true);

  // 1) a plain answer streams, the status goes running → idle, and the extras arrive
  const a = await turn(sid, 'Reply with the single word pong.');
  check('a prompt is answered and streamed', /pong/i.test(textSince(a.from)), JSON.stringify(textSince(a.from)).slice(0, 60));
  check('the turn ended ok', a.result.ok === true && !a.result.stopped);
  const init = await waitFor(is('session_init'), 5000);
  check('session_init reports a subscription login', init.authMode === 'subscription', init.authMode);
  await waitFor(is('usage'), 20_000);
  check('the context gauge data arrives (usage)', true);
  await waitFor(is('models'), 20_000);
  check('the model list arrives (models)', true);
  check('rate-limit windows arrive', events.some((e) => e.type === 'rate_limit' && e.fiveHour && e.sevenDay));

  // 2) a real permission request round trip: allow once, and the file really changes
  const b = await turn(sid, 'Use the Edit tool to change "hello" to "goodbye" in hello.txt, then reply done.', async (from) => {
    const req = await waitFor(is('permission_request', (e) => e.tool === 'Edit'), 90_000, from);
    check('an edit asks for permission with its input', req.input.old_string === 'hello' && req.canRemember);
    send({ type: 'permission_reply', sessionId: sid, reqId: req.reqId, decision: 'allow', scope: 'once' });
    await waitFor(is('request_resolved', (e) => e.reqId === req.reqId && e.outcome === 'allow'), 10_000, from);
  });
  check('the allowed edit happened on disk', readFileSync(join(dir, 'hello.txt'), 'utf8').includes('goodbye'));
  check('that turn ended ok', b.result.ok);

  // 3) deny: the file must stay as it is
  writeFileSync(join(dir, 'keep.txt'), 'keep me\n');
  const c = await turn(sid, 'Use the Write tool to overwrite keep.txt with the text changed. If refused, say refused.', async (from) => {
    const req = await waitFor(is('permission_request', (e) => e.tool === 'Write'), 90_000, from);
    send({ type: 'permission_reply', sessionId: sid, reqId: req.reqId, decision: 'deny', reason: 'smoke test says no' });
  });
  check('a denied write did not touch the file', readFileSync(join(dir, 'keep.txt'), 'utf8') === 'keep me\n');
  check('a denial is counted in the result', c.result.denials >= 1 || events.slice(c.from).some((e) => e.type === 'tool_end' && e.isError));

  // 4) Stop: the long command is interrupted, the turn is "stopped", and the very same session still works
  const from4 = mark();
  send({ type: 'prompt', sessionId: sid, text: 'Run this exact command with the Bash tool and wait for it: node -e "setTimeout(()=>{},60000)"' });
  const bashReq = await waitFor(is('permission_request', (e) => e.tool === 'Bash'), 90_000, from4);
  send({ type: 'permission_reply', sessionId: sid, reqId: bashReq.reqId, decision: 'allow', scope: 'once' });
  await waitFor(is('task', (e) => e.taskType === 'local_bash' && e.state === 'running'), 30_000, from4);
  await sleep(1500);
  send({ type: 'interrupt', sessionId: sid });
  const stopped = await waitFor(is('result', (e) => e.stopped === true), 60_000, from4);
  check('Stop interrupts a running command and reports "stopped", not an error', stopped.stopped && !stopped.ok);
  await waitFor(is('session_state', (e) => e.state === 'idle' && e.seq > stopped.seq), 30_000, from4);
  const d = await turn(sid, 'Reply with the single word alive.');
  check('the same session works after Stop', /alive/i.test(textSince(d.from)) && d.result.ok);

  // 5) queued prompt while busy: it waits, then runs by itself after the first turn
  const from5 = mark();
  send({ type: 'prompt', sessionId: sid, text: 'Reply with the single word one.' });
  await waitFor(is('session_state', (e) => e.state === 'running'), 30_000, from5);
  send({ type: 'prompt', sessionId: sid, text: 'Reply with the single word two.' });
  await waitFor(is('prompt_queued'), 10_000, from5);
  await waitFor(is('prompt_unqueued', (e) => e.reason === 'sent'), 90_000, from5);
  const results2 = () => events.slice(from5).filter((e) => e.type === 'result').length;
  for (let i = 0; i < 600 && results2() < 2; i++) await sleep(100);
  const said = textSince(from5).toLowerCase();
  check('a queued prompt waits and then runs after the first', results2() >= 2 && said.includes('one') && said.includes('two'));

  // 6) the browser can disappear and come back: a second client replays the whole session
  const replay: UiEvent[] = [];
  const ws2 = await new Promise<WebSocket>((res, rej) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin: `http://127.0.0.1:${PORT}` });
    s.once('open', () => res(s));
    s.once('error', rej);
  });
  ws2.on('message', (m) => replay.push(JSON.parse(m.toString())));
  ws2.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await sleep(300);
  ws2.send(JSON.stringify({ type: 'replay_from', sessionId: sid, seq: 0 }));
  await sleep(1500);
  const mine = events.filter((e): e is Extract<UiEvent, { seq: number }> => 'seq' in e && e.sessionId === sid);
  const theirs = replay.filter((e): e is Extract<UiEvent, { seq: number }> => 'seq' in e);
  check('a second browser replays every event of the session', theirs.length === mine.length && theirs.at(-1)?.seq === mine.at(-1)?.seq, `${theirs.length}/${mine.length}`);
  ws2.close();

  // 7) nothing in the stream was unrecognised
  const unknown = events.filter((e) => e.type === 'unknown');
  check('no unrecognised events from the real SDK', unknown.length === 0, unknown.length ? JSON.stringify(unknown[0]).slice(0, 160) : '');
  send({ type: 'close', sessionId: sid });
} catch (e) {
  check('the smoke test ran to the end', false, e instanceof Error ? e.message : String(e));
} finally {
  ws?.close();
  bridge.kill();
  // the conversation is stored by Claude Code under the throwaway folder; remove it so it never shows in a real recent-projects list
  if (sessionId) await sleep(500).then(() => deleteSession(sessionId!, { dir }).catch(() => undefined));
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ' — FAILED: ' + failed.map(([n]) => n).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);

// End-to-end check of the NVIDIA fallback against the REAL API: a session in a throwaway folder reads a file, asks permission
// before writing one, and reports its context usage. It spends a few thousand tokens of the NVIDIA key.
// Usage: npm run smoke:nvidia        (exit code 0 = everything held, 1 = something did not)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '@ci/shared';
import { crc32, deflateSync } from 'node:zlib';
import { NvidiaClient } from '../src/nvidia/client.ts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeScreenshot } from '../src/nvidia/tools/screenshot.ts';
import { executeAnalyzeImage, executeDetectObjects } from '../src/nvidia/tools/vision.ts';
import { NvidiaSession } from '../src/nvidia/session.ts';

if (!new NvidiaClient().isConfigured) {
  console.log('SKIP  no NVIDIA_API_KEY (set it in the environment or in .env)');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'ci-smoke-nvidia-'));
writeFileSync(join(dir, 'hello.txt'), 'hello world\n');

/** 256x256, white, with a red rectangle at (30,40)-(110,120) and a blue circle centred at (180,170), radius 45 */
function shapesPng(): Buffer {
  const W = 256, H = 256;
  const raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      let c = [255, 255, 255];
      if (x >= 30 && x <= 110 && y >= 40 && y <= 120) c = [220, 30, 30];
      if ((x - 180) ** 2 + (y - 170) ** 2 <= 45 ** 2) c = [30, 60, 220];
      raw.set(c, y * (W * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b)); return Buffer.concat([l, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(join(dir, 'shapes.png'), shapesPng());

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
      // a plan the model presents is rejected: the checks below are about what happens without approval
      if (e.type === 'plan' && !seen.has(e.reqId)) { seen.add(e.reqId); session.planReply(e.reqId, 'reject', 'not now'); }
    }
    const started = mine.some((e) => e.type === 'sdk_state' && e.state === 'running');
    if (started && mine.some((e) => e.type === 'sdk_state' && e.state === 'idle')) return mine;
    if (Date.now() - start > ms) throw new Error(`the turn did not finish in time; last events: ${mine.slice(-6).map((e) => e.type + ('name' in e ? ':' + e.name : '')).join(', ')}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

try {
  // 1. a read is free in Manual mode, and the answer comes from the file
  const t1 = await turn('Read hello.txt with your read tool and reply with the second word in it, nothing else.', () => check('a read does not ask', false));
  const text1 = t1.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('');
  check('the read card has Claude\'s name (Read)', t1.some((e) => e.type === 'tool_start' && e.name === 'Read'));
  check('the answer used the file', /world/i.test(text1), text1.slice(0, 60));
  check('no permission card for a read', !t1.some((e) => e.type === 'permission_request'));
  check('the context gauge got real usage', events.some((e) => e.type === 'usage' && e.totalTokens > 0));

  // 2. a write asks first, and runs once allowed
  let asked = '';
  const t2 = await turn('Create a file named out.txt in the current folder containing exactly the text: ok', (tool, reqId) => {
    asked = tool;
    session.permissionReply(reqId, 'allow');
  });
  check('a write asked first', asked === 'Write' || asked === 'Bash', asked);
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
  // 4. a subagent really does the work, and what it does reaches the UI nested under its card
  await session.setMode('acceptEdits');
  const t4 = await turn('Use the invoke_subagent tool to create a file named sub.txt containing exactly the text: done. The subagent must create the file itself. When it reports back, confirm in one sentence.', () => undefined);
  check('a subagent was started', t4.some((e) => e.type === 'tool_start' && e.name === 'Task' && !e.parentId));
  check('the subagent wrote the file', existsSync(join(dir, 'sub.txt')));
  check('its tool calls reached the UI nested under its card', t4.some((e) => e.type === 'tool_start' && Boolean(e.parentId)));
  check('its lane finished with token counts', t4.some((e) => e.type === 'task' && e.state === 'completed' && (e.tokens ?? 0) > 0));
  // 5. the vision tools, against the real endpoints, on an image whose content is known
  const seen = await executeAnalyzeImage({ path: 'shapes.png', question: 'What shapes are in the image and what colour is each? One sentence.' }, dir, []);
  check('analyze_image names the shapes and colours', !seen.isError && /red/i.test(seen.text) && /blue/i.test(seen.text), seen.text.slice(0, 90));
  check('analyze_image hands the picture back for the card', Boolean(seen.imageData?.length));
  const found = await executeDetectObjects({ path: 'shapes.png' }, dir, []);
  const near = (a: number, b: number) => Math.abs(a - b) <= 25;
  const redLine = found.text.split('\n').find((l) => /red/i.test(l)) ?? '';
  const redBox = (redLine.match(/-?\d+/g) ?? []).map(Number).slice(-4);
  check('detect_objects finds the red rectangle where it is', !found.isError && redBox.length === 4 && redBox.every((n, i) => near(n, [30, 40, 110, 120][i]!)), found.text.split('\n').slice(0, 3).join(' | '));
  const doc = await executeDetectObjects({ path: 'shapes.png', mode: 'document' }, dir, []);
  check('the document detector endpoint answers', !doc.isError, doc.text.slice(0, 80));
  const t5 = await turn('Look at shapes.png with your analyze_image tool and tell me in one sentence what colours the shapes are.', () => undefined);
  check('the agent used analyze_image and the card got the picture', t5.some((e) => e.type === 'tool_end' && (e.result.imageData?.length ?? 0) > 0));
  // 6. thinking: it really switches off and on, and the agent can change it itself
  const think = (enableThinking: boolean) => new NvidiaClient().streamChat({ model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', messages: [{ role: 'user', content: 'What is 17 * 23? Reply with just the number.' }], max_tokens: 1500, enableThinking }, {});
  const off = await think(false);
  const on = await think(true);
  check('enable_thinking false gives no reasoning', off.reasoning === '' && /391/.test(off.text), `reasoning ${off.reasoning.length} chars`);
  check('enable_thinking true gives reasoning', on.reasoning.length > 0 && /391/.test(on.text), `reasoning ${on.reasoning.length} chars`);
  const t6 = await turn('Call the set_thinking tool with enabled false (this next task is mechanical), then reply with the single word: ok', () => undefined);
  check('the agent switched its own thinking off and the UI was told', t6.some((e) => e.type === 'status' && e.thinking === false));
  // 7. the agent's eyes: a page whose keypad row is wider than the window, opened in a real browser
  const page = createServer((_q, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<title>Keypad</title><body style="margin:0;font-family:sans-serif"><h1>Calculator</h1><div style="display:flex;gap:8px;width:2400px">' + Array.from({ length: 12 }, (_, i) => '<button style="width:150px;height:60px">' + i + '</button>').join('') + '</div></body>');
  });
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (page.address() as AddressInfo).port;
  try {
    const shot = await executeScreenshot({ url: base, question: 'Is the row of number buttons fully visible, or is it cut off at the right edge? One sentence.' }, dir, []);
    check('screenshot reports the sideways overflow by itself', !shot.isError && shot.text.includes('Horizontal overflow: YES'), shot.text.split('\n')[2]?.slice(0, 110));
    check('screenshot returns the picture and a vision review', Boolean(shot.imageData?.length) && shot.text.includes('Vision review'));
    const t7 = await turn('Use your screenshot tool on ' + base + ' and tell me in one sentence whether the page has a layout problem.', () => undefined);
    check('the agent took the screenshot itself and the card got the picture', t7.some((e) => e.type === 'tool_end' && (e.result.imageData?.length ?? 0) > 0 && e.result.text.includes('Horizontal overflow')));
  } finally {
    page.close();
  }
} catch (e) {
  check('smoke run', false, e instanceof Error ? e.message : String(e));
} finally {
  session.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

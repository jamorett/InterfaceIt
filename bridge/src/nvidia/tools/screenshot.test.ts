import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decide } from '../permissions.ts';
import { executeScreenshot, screenshotTarget } from './screenshot.ts';

const cwd = process.platform === 'win32' ? 'C:\\proj' : '/proj';

describe('where a screenshot may point', () => {
  it('a dev server on this machine and a workspace file are local; another site is remote; other schemes are refused', () => {
    expect(screenshotTarget('http://localhost:5173/', cwd, [])).toMatchObject({ kind: 'local' });
    expect(screenshotTarget('http://127.0.0.1:4173', cwd, [])).toMatchObject({ kind: 'local' });
    expect(screenshotTarget('http://[::1]:3000', cwd, [])).toMatchObject({ kind: 'local' });
    expect(screenshotTarget('dist/index.html', cwd, [])).toMatchObject({ kind: 'local' });
    expect(screenshotTarget('https://example.com/page', cwd, [])).toMatchObject({ kind: 'remote', host: 'example.com' });
    for (const u of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'ftp://x/y', '']) expect(screenshotTarget(u, cwd, []).kind, u).toBe('error');
    const outside = process.platform === 'win32' ? 'C:\\other\\a.html' : '/other/a.html';
    expect(screenshotTarget(outside, cwd, []).kind).toBe('error');
  });

  it('local pages need no approval in any mode, other sites ask like web_fetch', () => {
    const kind = (mode: Parameters<typeof decide>[0], url: string) => decide(mode, 'screenshot', { url }, cwd, [], new Set()).kind;
    for (const m of ['default', 'acceptEdits', 'auto', 'plan', 'dontAsk'] as const) expect(kind(m, 'http://localhost:5173'), m).toBe('allow');
    expect(kind('default', 'https://example.com')).toBe('ask');
    expect(kind('plan', 'https://example.com')).toBe('ask');
    expect(kind('dontAsk', 'https://example.com')).toBe('deny');
    const remembered = new Set(['screenshot:example.com']);
    expect(decide('default', 'screenshot', { url: 'https://example.com/other' }, cwd, [], remembered).kind).toBe('allow');
  });
});

// the real thing: a browser opens a real page. Skipped where no Edge/Chrome can be started (e2e needs it anyway).
// decided while the file loads: it.skipIf is read when the tests are defined, before any beforeAll runs
const browserOk = await (async () => {
  try {
    const { chromium } = await import('@playwright/test');
    const b = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
    await b.close();
    return true;
  } catch { return false; }
})();
let server: Server;
let base = '';
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ci-shot-'));
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    // a row of boxes wider than the window, and a script error: the two things the tool must report
    if (req.url === '/calc') { res.end('<title>calc</title><output id="out"></output>' + ['2', '.', '5', '+', '3', '='].map((k) => '<button>' + k + '</button>').join('') + '<script>const o = document.getElementById("out"); document.querySelectorAll("button").forEach((b) => b.onclick = () => { o.textContent = b.textContent === "=" ? String(eval(o.textContent)) : o.textContent + b.textContent; }); document.onkeydown = (e) => { if (/^[0-9]$/.test(e.key)) o.textContent += e.key; };</script>'); return; }
    res.end(req.url === '/ok'
      ? '<title>fine</title><button>one</button><button>two</button>'
      : '<title>wide</title><div class="row" style="width:2000px;height:40px;background:#c33">too wide</div><script>throw new Error("boom")</script>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('screenshot (real browser)', () => {
  it.skipIf(!browserOk)('reports what sticks out, the script error, saves the picture and attaches it', async () => {
    const r = await executeScreenshot({ url: `${base}/wide`, width: 800 }, dir, []);
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Horizontal overflow: YES');
    expect(r.text).toContain('div.row');
    expect(r.text).toContain('page error: boom');
    expect(r.imageData?.[0]?.mediaType).toBe('image/png');
    const saved = /saved to (\S+?)\.\n/.exec(r.text)![1]!;
    expect(existsSync(join(dir, saved))).toBe(true);
  }, 60_000);

  it.skipIf(!browserOk)('a clean page reports no overflow and no problems, and counts its buttons', async () => {
    const r = await executeScreenshot({ url: `${base}/ok` }, dir, []);
    expect(r.text).toContain('Horizontal overflow: none');
    expect(r.text).toContain('Problems: none');
    expect(r.text).toContain('2 buttons');
  }, 60_000);

  it.skipIf(!browserOk)('operates the page like a user: clicks buttons by their label (a decimal point too) and reads the result', async () => {
    const r = await executeScreenshot({
      url: `${base}/calc`,
      actions: ['2', '.', '5', '+', '3', '='].map((click) => ({ click })),
      read: ['#out'],
    }, dir, []);
    expect(r.text).toContain('Actions: all 6 steps ran');
    expect(r.text).toContain('#out → "5.5"');
  }, 60_000);

  it.skipIf(!browserOk)('keyboard steps work, and a click that misses stops the run and lists the buttons that exist', async () => {
    const typed = await executeScreenshot({ url: `${base}/calc`, actions: [{ type: '7' }, { press: 'Enter' }], read: ['#out'] }, dir, []);
    expect(typed.text).toContain('#out → "7"');
    const missed = await executeScreenshot({ url: `${base}/calc`, actions: [{ click: '2' }, { click: '×' }, { click: '3' }], read: ['#out'] }, dir, []);
    expect(missed.text).toContain('step 2 {"click":"×"} FAILED');
    expect(missed.text).toContain('Buttons on the page: 2 . 5 + 3 =');
    expect(missed.text).toContain('The remaining steps were not run');
    expect(missed.text).toContain('#out → "2"'); // the first step did happen
  }, 60_000);

  it.skipIf(!browserOk)('an HTML file in the workspace opens, and a refused connection says what to do', async () => {
    writeFileSync(join(dir, 'page.html'), '<title>local file</title><p>hi</p>');
    expect((await executeScreenshot({ url: 'page.html' }, dir, [])).text).toContain('local file');
    const closed = await executeScreenshot({ url: 'http://127.0.0.1:1/' }, dir, []);
    expect(closed.isError).toBe(true);
    expect(closed.text).toContain('start it first');
  }, 60_000);
});

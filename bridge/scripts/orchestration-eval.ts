// Runs a multi-agent coding task against the REAL NVIDIA API in a throwaway folder and measures how the orchestration went:
// tool errors, files written by more than one agent, whether anything was verified, and how the result actually looks in a browser.
// It spends a lot of tokens (tens of thousands) and takes minutes. Usage: npx tsx bridge/scripts/orchestration-eval.ts <label>
// The report goes to .tmp/eval-<label>.json and a summary to the console.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SessionEvent } from '@ci/shared';
import { NvidiaClient } from '../src/nvidia/client.ts';
import { NvidiaSession } from '../src/nvidia/session.ts';

if (!new NvidiaClient().isConfigured) { console.log('SKIP  no NVIDIA_API_KEY'); process.exit(0); }

const label = process.argv[2] ?? 'run';
const dir = mkdtempSync(join(tmpdir(), `ci-eval-${label}-`));
const TASK = process.env.EVAL_TASK ?? [
  'Build a scientific calculator web page in this folder as plain HTML, CSS and JavaScript with no build tools and no installs.',
  'It must work when index.html is opened directly from the file system (double-click), so use classic <script> files, not ES modules.',
  'It needs: a display, digits 0-9, + - * / and =, clear, backspace, decimal point, parentheses, sin cos tan, log ln sqrt, a DEG/RAD toggle, memory keys (MC MR M+ M-), and keyboard input.',
  'The calculation logic must be correct (operator precedence, parentheses, division by zero) and the layout must look like a tidy calculator keypad on a desktop window and on a 420 px wide phone.',
  'Work in parallel with subagents where parts are independent. When you are done, make sure it really works and tell me what you verified.',
].join(' ');

const session = new NvidiaSession({ cwd: dir, mode: 'default' });
const events: SessionEvent[] = [];
session.subscribe((e) => events.push(e));

const DANGEROUS = /\b(rm|del|rmdir|rd|format|shutdown|curl|wget|iwr|Invoke-WebRequest|npm\s+(i|install|ci)|pnpm|yarn|pip|git\s+(push|reset|clean))\b/i;
let permissionRequests = 0;
let denied = 0;
const handled = new Set<string>();
function answerPending() {
  for (const e of events) {
    if (handled.has(String(('reqId' in e && e.reqId) || ''))) continue;
    if (e.type === 'permission_request') {
      handled.add(e.reqId);
      permissionRequests++;
      const cmd = String(e.input.command ?? '');
      const bad = (e.tool === 'Bash' && DANGEROUS.test(cmd)) || (typeof e.input.file_path === 'string' && /^[a-z]:|^\//i.test(e.input.file_path) && !String(e.input.file_path).toLowerCase().startsWith(dir.toLowerCase().replaceAll('\\', '/')) && !String(e.input.file_path).toLowerCase().startsWith(dir.toLowerCase()));
      if (bad) { denied++; session.permissionReply(e.reqId, 'deny', 'once', 'The evaluation harness does not allow that.'); } else session.permissionReply(e.reqId, 'allow', 'once');
    } else if (e.type === 'question') {
      handled.add(e.reqId);
      const answers: Record<string, string> = {};
      for (const q of e.questions) answers[q.question] = q.options[0]?.label ?? 'yes';
      session.answer(e.reqId, answers);
    } else if (e.type === 'plan') {
      handled.add(e.reqId);
      session.planReply(e.reqId, 'approve_manual');
    }
  }
}

const started = Date.now();
session.prompt(TASK);
let lastReport = 0;
let lastCount = 0;
let lastMove = Date.now();
let warnedStall = false;
for (;;) {
  if (events.length !== lastCount) { lastCount = events.length; lastMove = Date.now(); warnedStall = false; }
  if (!warnedStall && Date.now() - lastMove > 120_000) {
    warnedStall = true;
    console.log('  !! no events for 2 min. Last events: ' + events.slice(-6).map((e) => e.type + ('name' in e ? ':' + e.name : '') + ('state' in e ? ':' + String(e.state) : '')).join(', '));
  }
  answerPending();
  const ran = events.some((e) => e.type === 'sdk_state' && e.state === 'running');
  const lastSdk = [...events].reverse().find((e) => e.type === 'sdk_state') as { state: string } | undefined;
  const idle = ran && lastSdk?.state === 'idle'; // the last sdk_state, not the last event: a derived session_state can come after it
  if (idle || events.some((e) => e.type === 'session_ended')) break;
  if (Date.now() - started > 30 * 60_000) { console.log('TIMEOUT after 30 min'); break; }
  if (Date.now() - lastReport > 60_000) { lastReport = Date.now(); console.log(`  … ${Math.round((Date.now() - started) / 1000)}s, ${events.length} events, ${permissionRequests} permission requests`); }
  await new Promise((r) => setTimeout(r, 500));
}
const seconds = Math.round((Date.now() - started) / 1000);

// ---- what happened ----
const nameOf = new Map<string, string>();
const parentOf = new Map<string, string | undefined>();
const inputOf = new Map<string, Record<string, unknown>>();
for (const e of events) {
  if (e.type === 'tool_start') { nameOf.set(e.id, e.name); parentOf.set(e.id, e.parentId); }
  if (e.type === 'tool_input') inputOf.set(e.id, e.input as Record<string, unknown>);
}
const errors = events.flatMap((e) => (e.type === 'tool_end' && e.isError ? [{ tool: nameOf.get(e.id) ?? '?', agent: parentOf.get(e.id) ? 'subagent' : 'lead', text: e.result.text.replace(/\s+/g, ' ').slice(0, 140) }] : []));
const toolTexts = events.flatMap((e) => (e.type === 'tool_end' ? [e.result.text] : []));
const count = (needle: string) => toolTexts.filter((t) => t.includes(needle)).length;
const guard = {
  batchesRefused: count('Batch not run'),
  writesRefused: count('Refused:'),
  loopsBlocked: count('Blocked: you have sent this exact'),
  backgroundRefused: count('Do not start a background process'),
  sentBackToCheck: events.filter((e) => e.type === 'notice' && e.text.includes('sent back to check')).length,
  sentBackNeverDone: events.filter((e) => e.type === 'notice' && e.text.includes('Stopped after')).length,
};
const totalCalls = events.filter((e) => e.type === 'tool_start').length;
const byTool: Record<string, number> = {};
for (const x of errors) byTool[x.tool] = (byTool[x.tool] ?? 0) + 1;

// who wrote which file
const writers = new Map<string, Set<string>>();
for (const [id, name] of nameOf) {
  if (name !== 'Write' && name !== 'Edit') continue;
  const f = String(inputOf.get(id)?.file_path ?? '').replaceAll('\\', '/').split('/').pop() ?? '';
  const who = parentOf.get(id) ? `agent:${parentOf.get(id)!.slice(-6)}` : 'lead';
  if (!writers.has(f)) writers.set(f, new Set());
  writers.get(f)!.add(who);
}
const contested = [...writers].filter(([, w]) => w.size > 1).map(([f, w]) => `${f} (${[...w].join(', ')})`);

// every progress event of an agent says 'running': count the agents themselves, by the call that started each
const agents = [...new Set(events.filter((e) => e.type === 'task' && e.toolUseId).map((e) => (e as { toolUseId?: string }).toolUseId))];
const leadTools = [...nameOf].filter(([id]) => !parentOf.get(id)).map(([, n]) => n);
const verifiedWithBrowser = leadTools.includes('screenshot') || [...nameOf.values()].includes('screenshot');
const ranChecks = [...nameOf].some(([id, n]) => n === 'Bash' && /\b(node|npx|vitest|tsc|test|build|lint|check)\b/i.test(String(inputOf.get(id)?.command ?? '')));
const finalText = [...events].reverse().find((e) => e.type === 'text_delta') ? events.filter((e) => e.type === 'text_delta').slice(-400).map((e) => (e as { text: string }).text).join('').slice(-900) : '';

// ---- how it really looks ----
let page: Record<string, unknown> = { note: 'no index.html' };
const files = readdirSync(dir);
if (files.includes('index.html')) {
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ channel: 'msedge' });
    const out: Record<string, unknown> = {};
    for (const [w, h] of [[1280, 800], [420, 800]] as const) {
      const p = await browser.newPage({ viewport: { width: w, height: h } });
      const problems: string[] = [];
      p.on('pageerror', (er) => problems.push(er.message.slice(0, 100)));
      p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 100)); });
      await p.goto(pathToFileURL(join(dir, 'index.html')).href);
      await p.waitForTimeout(500);
      const facts = await p.evaluate(`(() => {
        const labels = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
        const dup = labels.filter((l, i) => l && labels.indexOf(l) !== i);
        return { canvases: document.querySelectorAll('canvas').length, tableRows: document.querySelectorAll('tr').length, textLength: document.body.innerText.length, buttons: labels.length, duplicateLabels: [...new Set(dup)], overflowX: document.documentElement.scrollWidth > innerWidth + 1, scrollWidth: document.documentElement.scrollWidth };
      })()`);
      out[`${w}px`] = { ...(facts as object), problems };
      if (w === 1280) { mkdirSync(join(process.cwd(), '.tmp'), { recursive: true }); await p.screenshot({ path: join(process.cwd(), '.tmp', `eval-${label}.png`), fullPage: true }); }
      // does it compute? type 2+3*4 with the keyboard or buttons, read the display
      if (w === 1280) {
        try {
          const spell: Record<string, string[]> = { '*': ['*', '×', 'x', '✕'], '/': ['/', '÷'], '-': ['-', '−', '–'] };
          for (const ch of ['2', '+', '3', '*', '4', '=']) {
            let clicked = false;
            for (const name of spell[ch] ?? [ch]) {
              const b = p.getByRole('button', { name, exact: true }).first();
              if (await b.count()) { await b.click({ timeout: 1500 }); clicked = true; break; }
            }
            if (!clicked) throw new Error(`no button "${ch}"`);
          }
          const text = await p.evaluate(`[...document.querySelectorAll('input, output, [id*=display], [class*=display]')].map((e) => (e.value ?? e.textContent ?? '').trim()).filter(Boolean).join(' | ')`);
          (out['1280px'] as Record<string, unknown>).twoPlusThreeTimesFour = text;
        } catch (er) { (out['1280px'] as Record<string, unknown>).twoPlusThreeTimesFour = `could not click through: ${(er as Error).message.split('\n')[0]}`; }
      }
      await p.close();
    }
    await browser.close();
    page = out;
  } catch (er) { page = { error: (er as Error).message.split('\n')[0] }; }
}

const report = {
  lastEvents: events.slice(-8).map((e) => e.type + ('name' in e ? ':' + e.name : '')),
  label, seconds, files, toolCalls: totalCalls, toolErrors: errors.length, errorRate: totalCalls ? +(errors.length / totalCalls).toFixed(2) : 0,
  errorsByTool: byTool, sampleErrors: errors.slice(0, 14), subagentsStarted: agents.length, contestedFiles: contested,
  guard, permissionRequests, denied, leadUsedBrowser: verifiedWithBrowser, someoneRanChecks: ranChecks, page, finalText,
};
mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
writeFileSync(join(process.cwd(), '.tmp', `eval-${label}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
session.close();
try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { console.log(`(the folder ${dir} is still in use, probably by a server the agent left running)`); }
void readFileSync;

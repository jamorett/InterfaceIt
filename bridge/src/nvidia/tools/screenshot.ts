import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPathInsideRoots, resolveSafePath } from './read.ts';
import { executeAnalyzeImage, type VisionResult } from './vision.ts';

export interface ScreenshotInput {
  url: string;
  width?: number;
  height?: number;
  full_page?: boolean;
  wait_ms?: number;
  wait_for?: string;
  out?: string;
  question?: string;
  /** steps to perform on the page before the picture is taken: click, type, press a key, wait */
  actions?: { click?: string; type?: string; press?: string; wait_ms?: number }[];
  /** selectors whose text (or value) is reported after the actions, e.g. the display of a calculator */
  read?: string[];
}

export type ScreenshotTarget =
  | { kind: 'local'; href: string }
  | { kind: 'remote'; href: string; host: string }
  | { kind: 'error'; message: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DISPLAY_MAX = 500_000; // a bigger picture is saved and reviewed, but not copied into the event log

/**
 * Where a url points. A page on this machine (a dev server, or an HTML file inside the workspace) is local and needs no
 * approval; any other site is remote and is asked about like web_fetch. Other schemes are refused.
 */
export function screenshotTarget(url: string, cwd: string, addDirs: string[]): ScreenshotTarget {
  const raw = url.trim();
  if (!raw) return { kind: 'error', message: 'Error: "url" is required (for example http://localhost:5173 or an HTML file in the workspace).' };
  const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(raw)?.[1]?.toLowerCase(); // two letters at least: "C:\x" is a Windows path, not a scheme
  if (!scheme) {
    const file = resolveSafePath(cwd, raw, addDirs);
    return isPathInsideRoots(cwd, file, addDirs) ? { kind: 'local', href: pathToFileURL(file).href } : { kind: 'error', message: `Error: ${raw} is outside the workspace.` };
  }
  if (scheme === 'file') {
    try {
      const file = fileURLToPath(raw);
      return isPathInsideRoots(cwd, file, addDirs) ? { kind: 'local', href: raw } : { kind: 'error', message: 'Error: that file is outside the workspace.' };
    } catch { return { kind: 'error', message: `Error: "${raw}" is not a valid file URL.` }; }
  }
  if (scheme !== 'http' && scheme !== 'https') return { kind: 'error', message: `Error: only http, https and workspace files can be opened (got ${scheme}:).` };
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
    return LOCAL_HOSTS.has(host) ? { kind: 'local', href: raw } : { kind: 'remote', href: raw, host };
  } catch { return { kind: 'error', message: `Error: "${raw}" is not a valid URL.` }; }
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => Math.min(Math.max(Math.trunc(Number(n)) || dflt, lo), hi);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// what the page looks like from the inside: size, how many controls, and which elements stick out of the window sideways
const FACTS = `(() => {
  const vw = innerWidth;
  const wide = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (r.right > vw + 1 || r.left < -1);
  }).slice(0, 6).map((el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''));
  return { title: document.title, scrollWidth: document.documentElement.scrollWidth, vw, buttons: document.querySelectorAll('button').length, links: document.querySelectorAll('a[href]').length, inputs: document.querySelectorAll('input,textarea,select').length, wide };
})()`;

// the visible buttons, to tell the agent what it can click when a click misses (a calculator may say × where it expected *)
const LABELS = `[...document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')].map((b) => (b.textContent || b.value || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60)`;

/** A plain word is the exact name of a button or text on the page; anything that looks like a selector is used as one. */
function locate(page: import('@playwright/test').Page, target: string) {
  // "7", ".", "(" and "M+" are button labels; "#out", ".key", "button:has-text('7')" and "css=..." are selectors
  if (/^(css=|text=|xpath=|role=|id=)|^[#.][A-Za-z_-]|[[>]|:[a-z-]+\(|^[a-z][\w-]*[.#[:]/i.test(target)) return page.locator(target).first();
  const button = page.getByRole('button', { name: target, exact: true }).first();
  return button.or(page.getByText(target, { exact: true }).first()).first();
}

/** Opens a page in a real browser (Edge or Chrome, headless), checks it, saves a screenshot and, with a question, has the vision model review it. */
export async function executeScreenshot(input: ScreenshotInput, cwd: string, addDirs: string[], signal?: AbortSignal): Promise<VisionResult> {
  const target = screenshotTarget(String(input.url ?? ''), cwd, addDirs);
  if (target.kind === 'error') return { text: target.message, isError: true };

  const outPath = input.out ? resolveSafePath(cwd, input.out, addDirs) : join(cwd, '.tmp', 'scratch', `screenshot-${Date.now()}.png`);
  if (!isPathInsideRoots(cwd, outPath, addDirs)) return { text: 'Error: "out" must be inside the workspace.', isError: true };

  let pw: typeof import('@playwright/test');
  try { pw = await import('@playwright/test'); } catch { return { text: 'Error: Playwright is not installed next to ClaudeInterface, so no browser can be driven. Run `npm install` in the ClaudeInterface folder.', isError: true }; }

  // the browser the machine has: Edge first (it ships with Windows), then Chrome
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>> | undefined;
  let launchError = '';
  for (const channel of ['msedge', 'chrome'] as const) {
    try { browser = await pw.chromium.launch({ channel, headless: true }); break; } catch (e) { launchError = e instanceof Error ? e.message.split('\n')[0]! : String(e); }
  }
  if (!browser) return { text: `Error: no browser could be started (${launchError}). Microsoft Edge or Google Chrome must be installed.`, isError: true };
  const onAbort = () => { void browser!.close().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const width = clamp(input.width, 200, 2560, 1280);
    const height = clamp(input.height, 200, 2000, 800);
    const page = await browser.newPage({ viewport: { width, height } });
    const problems: string[] = [];
    const note = (s: string) => { if (problems.length < 6) problems.push(s); };
    page.on('console', (m) => { if (m.type() === 'error') note(`console error: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => note(`page error: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', (r) => note(`request failed: ${r.url().slice(0, 100)}`));

    // a dev server started a moment ago may not be listening yet: retry the connection for a few seconds
    const t0 = Date.now();
    let status: number | undefined;
    let navError = '';
    for (;;) {
      try { status = (await page.goto(target.href, { waitUntil: 'load', timeout: 20_000 }))?.status() ?? 0; break; } catch (e) {
        navError = e instanceof Error ? e.message.split('\n')[0]! : String(e);
        if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(navError) || Date.now() - t0 > 12_000 || signal?.aborted) break;
        await sleep(600);
      }
    }
    if (status === undefined) return { text: `Could not open ${input.url}: ${navError}. If it is a dev server, start it first (bash with run_in_background) and give it a moment to listen.`, isError: true };

    if (input.wait_for) await page.waitForSelector(input.wait_for, { timeout: 5000 }).catch(() => note(`the selector "${input.wait_for}" never appeared`));
    await page.waitForTimeout(clamp(input.wait_ms, 0, 10_000, 500));

    // operate the page like a user would, so behaviour is tested and not only looks: 2+3×4 typed on the keypad must read 14
    const steps = Array.isArray(input.actions) ? input.actions.slice(0, 80) : [];
    const stepLog: string[] = [];
    for (const [i, a] of steps.entries()) {
      try {
        if (typeof a.click === 'string' && a.click) await locate(page, a.click).click({ timeout: 3000 });
        else if (typeof a.type === 'string') await page.keyboard.type(a.type, { delay: 15 });
        else if (typeof a.press === 'string' && a.press) await page.keyboard.press(a.press);
        else if (a.wait_ms) await page.waitForTimeout(clamp(a.wait_ms, 0, 5000, 300));
        else continue;
      } catch (e) {
        const labels = (await page.evaluate(LABELS).catch(() => [])) as string[];
        stepLog.push(`step ${i + 1} ${JSON.stringify(a)} FAILED: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}. Buttons on the page: ${labels.join(' ') || '(none)'}. The remaining steps were not run.`);
        break;
      }
    }
    const reads: string[] = [];
    for (const sel of (Array.isArray(input.read) ? input.read : []).slice(0, 10)) {
      const val = await page.locator(sel).first().evaluate((el) => ((el as unknown as { value?: string }).value ?? el.textContent ?? '').trim()).catch(() => undefined);
      reads.push(`${sel} → ${val === undefined ? '(not found)' : JSON.stringify(val.slice(0, 200))}`);
    }

    const facts = (await page.evaluate(FACTS)) as { title: string; scrollWidth: number; vw: number; buttons: number; links: number; inputs: number; wide: string[] };
    const png = await page.screenshot({ fullPage: input.full_page === true });
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, png);
    const shown = relative(cwd, outPath) || outPath;

    const overflow = facts.scrollWidth > facts.vw + 1 || facts.wide.length > 0
      ? `YES: the page is ${facts.scrollWidth}px wide in a ${facts.vw}px window${facts.wide.length ? `; elements sticking out: ${facts.wide.join(', ')}` : ''}`
      : 'none';
    let text = [
      `Screenshot of ${input.url} (${width}x${height}${input.full_page ? ', full page' : ''}, HTTP ${status || 'n/a'}) saved to ${isAbsolute(shown) ? shown : shown.replaceAll('\\', '/')}.`,
      `Page title: "${facts.title}". ${facts.buttons} buttons, ${facts.links} links, ${facts.inputs} inputs.`,
      `Horizontal overflow: ${overflow}.`,
      `Problems: ${problems.length ? problems.join(' | ') : 'none'}.`,
      ...(steps.length ? [stepLog.length ? `Actions: ${stepLog.join(' ')}` : `Actions: all ${steps.length} steps ran.`] : []),
      ...(reads.length ? [`Read after the actions: ${reads.join('; ')}.`] : []),
    ].join('\n');

    if (typeof input.question === 'string' && input.question.trim()) {
      const review = await executeAnalyzeImage({ path: outPath, question: input.question }, cwd, addDirs, signal);
      text += `\n\nVision review of the screenshot:\n${review.text}`;
    } else text += '\n\nLook at it with analyze_image (ask about what matters), or pass `question` next time to get the review in this call.';

    return { text, isError: false, imageData: png.length <= DISPLAY_MAX ? [{ mediaType: 'image/png', data: png.toString('base64') }] : undefined };
  } catch (e) {
    return { text: `Screenshot failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`, isError: true };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}

// The whole stack, end to end: browser → WebSocket → bridge → (recorded real Claude sessions) → normalizer → state → screen.
// The bridge runs with --fake, so nothing here spends usage. Put [[name]] in a prompt to pick the recording.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { TOKEN } from './token.ts';

async function start(page: Page) {
  await page.goto(`/#t=${TOKEN}`);
  // exact: sessions already running elsewhere are listed above with the same folder in their label
  await page.getByRole('button', { name: 'C:/demo/ClaudeInterface', exact: true }).click();
  await expect(page.getByLabel('Message')).toBeEnabled();
}
async function say(page: Page, text: string) {
  await page.getByLabel('Message').fill(text);
  await page.keyboard.press('Enter');
}
const idle = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Idle$/ }).first()).toBeVisible({ timeout: 15_000 });

test.describe('a conversation', () => {
  test('streams an answer with tool cards and ends idle', async ({ page }) => {
    await start(page);
    await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
    await say(page, '[[basic]] read the file and run echo');
    await expect(page.getByText('[[basic]] read the file and run echo')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Read / })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bash echo probe/ })).toBeVisible();
    await expect(page.getByText(/Steps 1 and 2 are done/)).toBeVisible();
    await idle(page);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  });

  test('a tool card opens to show what the command printed', async ({ page }) => {
    await start(page);
    await say(page, '[[basic]] go');
    const bash = page.getByRole('button', { name: /Bash echo probe/ });
    await expect(bash).toBeVisible();
    await bash.click();
    await expect(page.getByLabel('Bash output')).toContainText('probe');
  });

  test('a local slash command shows as a local-command block', async ({ page }) => {
    await start(page);
    await say(page, '[[slash]] /context');
    await expect(page.getByText('Local command')).toBeVisible();
    await expect(page.getByText('Context Usage').first()).toBeVisible();
  });

  test('the header shows the model list the session reported', async ({ page }) => {
    await start(page);
    await say(page, '[[basic]] go');
    await idle(page);
    await expect(page.getByLabel('Model').locator('option', { hasText: 'Opus' }).first()).toBeAttached();
  });
});

test.describe('Claude asks, the user answers', () => {
  test('Y approves an edit, the tab title flags it while waiting, and the turn continues', async ({ page }) => {
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await expect(card).toBeVisible();
    await expect(page).toHaveTitle(/◆ \(1\)/);
    await expect(card.getByText('goodbye')).toBeVisible(); // the diff preview
    await card.focus();
    await page.keyboard.press('y');
    await expect(page.getByText('Allowed once')).toBeVisible();
    await expect(page).toHaveTitle('ClaudeInterface');
    await idle(page);
  });

  test('denying with a reason is shown and the turn still finishes', async ({ page }) => {
    await start(page);
    await say(page, '[[denial]] write a file');
    const card = page.getByRole('alert', { name: /Needs your OK: Write/ });
    await card.getByRole('button', { name: 'Deny…' }).click();
    await card.getByLabel('Tell Claude why (optional)').fill('not in this folder');
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(page.getByText('“not in this folder”')).toBeVisible();
    await idle(page);
  });

  test('"Allow for…" offers the places a rule can be remembered', async ({ page }) => {
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await card.getByRole('button', { name: 'Allow for…' }).click();
    await card.getByRole('button', { name: 'This session' }).click();
    await expect(page.getByText('Allowed for this session')).toBeVisible();
    await idle(page);
  });

  test('a question is answered and the answer is what Claude then says', async ({ page }) => {
    await start(page);
    await say(page, '[[ask]] ask me a colour');
    const card = page.getByRole('alert', { name: /Claude has a question/ });
    await card.getByLabel(/Blue/).check();
    await card.getByRole('button', { name: 'Answer' }).click();
    await expect(page.getByText('You answered: Blue')).toBeVisible();
    await idle(page);
  });

  test('a plan is approved, then the file write it leads to is approved too', async ({ page }) => {
    await start(page);
    await say(page, '[[plan]] plan notes.txt');
    await page.getByRole('button', { name: 'Approve and auto-accept edits' }).click();
    await expect(page.getByText('Plan approved (edits accepted automatically)')).toBeVisible();
    const write = page.getByRole('alert', { name: /Needs your OK: Write/ });
    await write.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.getByText(/I created `?notes\.txt/).first()).toBeVisible();
    await idle(page);
  });
});

test.describe('Stop and the queue', () => {
  test('Stop cancels what is waiting, says "Stopped", and frees the composer', async ({ page }) => {
    await start(page);
    await say(page, '[[interrupt]] run a long command');
    await expect(page.getByRole('alert', { name: /Needs your OK: Bash/ })).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Cancelled (you pressed Stop)')).toBeVisible();
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
    await idle(page);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  });

  test('a message sent while Claude works waits in a queue, can be removed, and the next one runs after', async ({ page }) => {
    await start(page);
    await say(page, '[[queue]] first');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await say(page, 'drop me');
    await say(page, '[[basic]] second');
    const queue = page.getByRole('list', { name: 'Queued' });
    await expect(queue.getByText('drop me')).toBeVisible();
    await queue.getByText('drop me').locator('..').getByRole('button', { name: 'Remove queued message' }).click();
    await expect(queue.getByText('drop me')).toHaveCount(0);
    await expect(page.getByText('[[basic]] second').first()).toBeVisible({ timeout: 15_000 }); // sent once the first turn ended
    await expect(page.getByText(/Steps 1 and 2 are done/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('drop me')).toHaveCount(0);
  });
});

test.describe('connection and sessions', () => {
  test('after a dropped connection it says so, reconnects, and the conversation is intact with nothing duplicated', async ({ page }) => {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => { ws.connectToServer(); sockets.push(ws); });
    await start(page);
    await say(page, '[[basic]] go');
    await idle(page);
    const cards = page.getByRole('button', { name: /^Read / });
    await expect(cards).toHaveCount(1);

    await sockets.at(-1)!.close(); // the newest: React's dev double-mount opens (and drops) an earlier one
    await expect(page.getByText(/Connection lost\. Reconnecting/)).toBeVisible();
    await expect(page.getByLabel('Message')).toBeDisabled();
    await expect(page.getByText(/Connection lost/)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByLabel('Message')).toBeEnabled();
    await expect(cards).toHaveCount(1);
    await expect(page.getByText(/Steps 1 and 2 are done/)).toHaveCount(1);
    await say(page, '[[queue]] still works');
    await expect(page.getByText('still works')).toBeVisible();
  });

  test('reloading the page re-attaches to the session that kept running in the bridge', async ({ page }) => {
    await start(page);
    await say(page, '[[basic]] go');
    await idle(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Read / })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Steps 1 and 2 are done/)).toBeVisible();
    await expect(page.getByLabel('Message')).toBeEnabled();
  });

  test('another tab can take over a session that is still running', async ({ page, context }) => {
    await start(page);
    await say(page, '[[basic]] take me over please');
    await idle(page);
    const other = await context.newPage();
    await other.goto(`/#t=${TOKEN}`);
    await expect(other.getByRole('heading', { name: 'Choose a project' })).toBeVisible(); // a new tab starts clean...
    await other.getByRole('button', { name: /take me over please/ }).click(); // ...and offers what is running
    await expect(other.getByText(/Steps 1 and 2 are done/).first()).toBeVisible();
    await expect(other.getByLabel('Message')).toBeEnabled();
  });

  test('a folder nobody trusted yet asks first, and works once trusted', async ({ page }) => {
    await page.goto(`/#t=${TOKEN}`);
    await page.getByLabel('Browse for a folder').fill('C:\\work\\untrusted-folder');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Do you trust this folder?' })).toBeVisible();
    await expect(page.getByText('C:\\work\\untrusted-folder')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
    await page.getByLabel('Browse for a folder').fill('C:\\work\\untrusted-folder');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, I trust it' }).click();
    await expect(page.getByLabel('Message')).toBeEnabled();
  });

  test('New session returns to the project list while the old session stays in the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 800 });
    await start(page);
    await say(page, '[[basic]] remember me');
    await idle(page);
    await page.locator('button[title="New session"]').click(); // other sessions in the list can carry the same title
    await expect(page.getByRole('heading', { name: 'Choose a project' })).toBeVisible();
  });

  test('the sidebar lists the open session and clicking it brings it back', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 800 });
    await start(page);
    await say(page, '[[basic]] sidebar title');
    await idle(page);
    const nav = page.getByRole('navigation', { name: 'Sessions' });
    await expect(nav.getByText('[[basic]] sidebar title')).toBeVisible();
    await nav.getByRole('button', { name: /sidebar title/ }).click();
    await expect(page.getByText(/Steps 1 and 2 are done/)).toBeVisible();
  });
});

test.describe('the live app is accessible and responsive', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [360, 1280]) {
      test(`a finished conversation, ${scheme} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await start(page);
        await say(page, '[[basic]] go');
        await idle(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      });
    }
  }

  test('a permission request on a phone-width window is fully usable', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await card.getByRole('button', { name: 'Allow', exact: true }).click();
    await idle(page.locator('body').page());
  });
});

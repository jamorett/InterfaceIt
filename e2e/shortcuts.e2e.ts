// Keyboard shortcuts, editing before allowing, and OS notifications, all through the real UI against replayed sessions.
import { expect, test, type Page } from '@playwright/test';
import { assertNoBuildError } from './helpers.ts';
import { TOKEN } from './token.ts';

async function start(page: Page) {
  await page.goto(`/#t=${TOKEN}`);
  await assertNoBuildError(page);
  await page.getByRole('button', { name: 'C:/demo/ClaudeInterface', exact: true }).click();
  await expect(page.getByLabel('Message')).toBeEnabled();
}
async function say(page: Page, text: string) {
  await page.getByLabel('Message').fill(text);
  await page.keyboard.press('Enter');
}
const idle = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Idle$/ }).first()).toBeVisible({ timeout: 15_000 });

test.describe('Esc', () => {
  test('stops a running turn when nothing else is open and the message box is empty', async ({ page }) => {
    await start(page);
    await say(page, '[[interrupt]] long command');
    await expect(page.getByRole('alert', { name: /Needs your OK: Bash/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Cancelled (you pressed Stop)')).toBeVisible();
    await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
    await idle(page);
  });

  test('first only leaves a half-typed message, and only the next Esc stops', async ({ page }) => {
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await expect(card).toBeVisible();
    await page.getByLabel('Message').fill('a draft I am typing');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Message')).not.toBeFocused();
    await expect(page.getByLabel('Message')).toHaveValue('a draft I am typing'); // nothing lost
    await expect(card).toBeVisible(); // not stopped yet
    await page.keyboard.press('Escape');
    await expect(page.getByText('Cancelled (you pressed Stop)')).toBeVisible();
  });

  test('does nothing when Claude is idle', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Stopped', { exact: true })).toHaveCount(0);
  });
});

test.describe('other shortcuts', () => {
  test('Ctrl+Shift+M cycles the permission mode and the menu follows', async ({ page }) => {
    await start(page);
    const mode = page.getByLabel('Permissions');
    await expect(mode).toHaveValue('default');
    await page.keyboard.press('Control+Shift+M');
    await expect(mode).toHaveValue('acceptEdits');
    await page.keyboard.press('Control+Shift+M');
    await expect(mode).toHaveValue('plan');
  });

  test('Alt+↓ / Alt+↑ move to the card that is waiting for you', async ({ page }) => {
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await expect(card).toBeVisible();
    await page.getByLabel('Message').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(card).toBeFocused();
    await page.getByLabel('Message').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(card).toBeFocused();
  });
});

test.describe('edit before allowing', () => {
  test('the changed command, and only that field, is what the bridge is told to allow', async ({ page }) => {
    const sent: string[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => { sent.push(String(m)); server.send(m); });
      server.onMessage((m) => ws.send(m));
    });
    await start(page);
    await say(page, '[[interrupt]] run something');
    const card = page.getByRole('alert', { name: /Needs your OK: Bash/ });
    await card.getByRole('button', { name: 'Edit command…' }).click();
    const box = card.getByLabel('Command to run');
    await expect(box).toHaveValue(/setTimeout/);
    await box.fill('echo edited');
    await card.getByRole('button', { name: 'Allow edited command' }).click();
    await expect(page.getByText('Allowed once')).toBeVisible();
    const reply = sent.map((s) => JSON.parse(s)).find((m) => m.type === 'permission_reply');
    expect(reply).toMatchObject({ decision: 'allow', scope: 'once', editedInput: { command: 'echo edited' } });
    expect(Object.keys(reply.editedInput)).toEqual(['command']);
  });

  test('"keep original" closes the editor without changing anything', async ({ page }) => {
    await start(page);
    await say(page, '[[interrupt]] run something');
    const card = page.getByRole('alert', { name: /Needs your OK: Bash/ });
    await card.getByRole('button', { name: 'Edit command…' }).click();
    await card.getByLabel('Command to run').fill('something else');
    await card.getByRole('button', { name: 'Keep original' }).click();
    await expect(card.getByLabel('Command to run')).toHaveCount(0);
    await card.getByRole('button', { name: 'Edit command…' }).click();
    await expect(card.getByLabel('Command to run')).toHaveValue(/setTimeout/);
  });

  test('only commands can be edited: an Edit request has no editor', async ({ page }) => {
    await start(page);
    await say(page, '[[edit]] change hello');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit command…' })).toHaveCount(0);
  });
});

test.describe('notifications', () => {
  const stub = (focused: boolean) => `
    window.__notes = [];
    window.Notification = class { constructor(title, o) { window.__notes.push({ title, body: o && o.body }); } close() {} static requestPermission() { return Promise.resolve('granted'); } };
    window.Notification.permission = 'granted';
    document.hasFocus = () => ${focused};
  `;
  const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: { title: string; body: string }[] }).__notes);

  test('a window out of sight is told when Claude needs it and when the turn is done', async ({ page }) => {
    await page.addInitScript(stub(false));
    await start(page);
    await say(page, '[[edit]] change hello');
    await expect(page.getByRole('alert', { name: /Needs your OK: Edit/ })).toBeVisible();
    await expect.poll(async () => (await notes(page)).map((n) => n.title)).toContain('Claude needs your approval');
    await page.getByRole('alert', { name: /Needs your OK: Edit/ }).getByRole('button', { name: 'Allow', exact: true }).click();
    await idle(page);
    await expect.poll(async () => (await notes(page)).map((n) => n.title)).toContain('Claude finished');
    expect((await notes(page)).every((n) => n.body === 'ClaudeInterface')).toBe(true); // names the project, nothing else
  });

  test('a window you are looking at is not interrupted', async ({ page }) => {
    await page.addInitScript(stub(true));
    await start(page);
    await say(page, '[[edit]] change hello');
    await expect(page.getByRole('alert', { name: /Needs your OK: Edit/ })).toBeVisible();
    await page.getByRole('alert', { name: /Needs your OK: Edit/ }).getByRole('button', { name: 'Allow', exact: true }).click();
    await idle(page);
    expect(await notes(page)).toEqual([]);
  });

  test('re-attaching a finished session after a reload does not replay old news', async ({ page }) => {
    await page.addInitScript(stub(false));
    await start(page);
    await say(page, '[[basic]] go');
    await idle(page);
    await expect.poll(async () => (await notes(page)).length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByLabel('Message')).toBeEnabled({ timeout: 10_000 });
    expect(await notes(page)).toEqual([]); // fresh page, history replayed: silence
  });
});

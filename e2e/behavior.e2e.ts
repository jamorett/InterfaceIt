import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, state: string) {
  await page.goto(`/dev/shell?state=${state}`);
  await page.locator('[data-ready]').waitFor();
}

// the gallery's id sits on the heading; the section is what contains the content
const section = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}"]`);

test.describe('permission card', () => {
  test('Y allows, with no animation class left to play', async ({ page }) => {
    await open(page, 'awaiting-permission');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await card.focus();
    await page.keyboard.press('y');
    await expect(page.getByText('Allowed once')).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test('N denies', async ({ page }) => {
    await open(page, 'awaiting-permission');
    await page.getByRole('alert', { name: /Needs your OK: Edit/ }).focus();
    await page.keyboard.press('n');
    await expect(page.getByText('Denied').last()).toBeVisible();
  });

  test('A opens the scope list and choosing one decides', async ({ page }) => {
    await open(page, 'awaiting-permission');
    await page.getByRole('alert', { name: /Needs your OK: Edit/ }).focus();
    await page.keyboard.press('a');
    await page.getByRole('button', { name: 'This project, only me' }).click();
    await expect(page.getByText('Allowed for this project (only you)')).toBeVisible();
  });

  test('typing a reason does not trigger the shortcuts', async ({ page }) => {
    await open(page, 'awaiting-permission');
    const card = page.getByRole('alert', { name: /Needs your OK: Edit/ });
    await card.getByRole('button', { name: 'Deny…' }).click();
    await card.getByLabel('Tell Claude why (optional)').fill('yes no and a');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(page.getByText('“yes no and a”')).toBeVisible();
  });

  test('a request that always needs a person offers no "allow for…"', async ({ page }) => {
    await open(page, 'awaiting-permission-person');
    const card = page.getByRole('alert', { name: /Leave plan mode/ });
    await expect(card.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Allow for…' })).toHaveCount(0);
  });
});

test.describe('question and plan', () => {
  test('answering a question collapses it into a summary', async ({ page }) => {
    await open(page, 'awaiting-question');
    const card = page.getByRole('alert', { name: /Claude has a question: Which colour/ });
    await expect(card.getByRole('button', { name: 'Answer' })).toBeDisabled();
    await card.getByLabel(/Blue/).check();
    await card.getByRole('button', { name: 'Answer' }).click();
    await expect(page.getByText('You answered: Blue')).toBeVisible();
  });

  test('a plan can be rejected with feedback', async ({ page }) => {
    await open(page, 'plan-review');
    await page.getByRole('button', { name: 'Reject…' }).click();
    await page.getByLabel('What should change?').fill('Skip step 3');
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect(page.getByText('Plan rejected')).toBeVisible();
  });
});

test.describe('layout', () => {
  test('narrow: the sessions drawer opens from the menu and Escape closes it', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await open(page, 'running');
    await expect(page.getByRole('navigation', { name: 'Sessions' })).toBeHidden();
    await page.getByRole('button', { name: 'Open sessions' }).click();
    await expect(page.getByRole('navigation', { name: 'Sessions' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Sessions' })).toBeHidden();
  });

  test('narrow: the status bar folds into the header menu', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await open(page, 'running');
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await page.locator('summary[aria-label="More"]').click();
    await expect(page.getByRole('meter', { name: 'Context' })).toBeVisible();
  });

  test('laptop: icon rail; Ctrl+B widens it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 760 });
    await open(page, 'running');
    const nav = page.getByRole('navigation', { name: 'Sessions' });
    await expect(page.getByPlaceholder('Search sessions')).toHaveCount(0);
    await page.keyboard.press('Control+b');
    await expect(page.getByPlaceholder('Search sessions')).toBeVisible();
    await expect(nav).toBeVisible();
  });

  test('desktop: the inspector docks beside the transcript; narrower it becomes a sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'inspector');
    const inspector = page.getByRole('complementary', { name: 'Edit ui/src/store.ts' });
    await expect(inspector).toBeVisible();
    const transcript = await page.getByRole('log').boundingBox();
    const box = await inspector.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(transcript!.x + transcript!.width - 1); // beside it, not over it
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByRole('button', { name: 'Close details' }).first()).toBeAttached();
  });

  test('every session state carries a text label, not only a colour', async ({ page }) => {
    await page.goto('/dev/tokens');
    for (const label of ['Idle', 'Working', 'Needs you', 'Compacting', 'Retrying', 'Limit reached', 'Error', 'Ended']) {
      await expect(section(page, 'states').getByText(label).first()).toBeVisible();
    }
  });
});

test.describe('resilience', () => {
  test('a card whose renderer throws is replaced by raw data and the rest of the conversation survives', async ({ page }) => {
    await open(page, 'hostile');
    await expect(page.getByRole('group', { name: 'This card could not be shown' })).toHaveCount(2); // the malformed tool + the forced crash
    await expect(page.getByText('SomeFutureTool')).toBeVisible(); // an unknown tool still gets the normal card
    await expect(page.getByText('Unrecognised event')).toBeVisible(); // debug view
  });

  test('a failed tool stays open', async ({ page }) => {
    await open(page, 'tool-failed');
    await expect(page.getByRole('button', { name: /Bash/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Bash output')).toContainText('no-unused-vars');
  });

  test('disconnected and rate-limited states keep the draft and pause sending', async ({ page }) => {
    await open(page, 'disconnected');
    await expect(page.getByRole('alert')).toContainText('Reconnecting');
    await expect(page.getByLabel('Message')).toBeDisabled();
    await expect(page.getByLabel('Message')).toHaveValue('Then also check the other tests');
    await open(page, 'rate-limited');
    await expect(page.getByLabel('Message')).toBeDisabled();
  });

  test('the bypass-permissions warning is always visible', async ({ page }) => {
    await open(page, 'bypass');
    await expect(page.getByText('Permissions are off')).toBeVisible();
  });
});

test.describe('animation gate in the live gallery', () => {
  test('50 tools at once: ten animate, forty appear instantly', async ({ page }) => {
    await page.goto('/dev/tokens');
    await page.getByRole('button', { name: '50 tools at once (burst guard)' }).click();
    await expect(section(page, 'live').locator('[data-instant]')).toHaveCount(40);
  });

  test('history replayed all at once never animates', async ({ page }) => {
    await page.goto('/dev/tokens');
    await page.getByRole('button', { name: 'Replay as history (no animation)' }).click();
    await expect(section(page, 'live').locator('[data-instant]')).toHaveCount(4);
  });

  test('a live session animates, asks for permission, and finishes after Allow', async ({ page }) => {
    await page.goto('/dev/tokens');
    await page.getByRole('button', { name: 'Play live' }).click();
    const live = section(page, 'live');
    const card = live.getByRole('alert', { name: /Needs your OK/ });
    await expect(card).toBeVisible({ timeout: 6000 });
    await expect(live.locator('[data-instant]')).toHaveCount(0); // live events animate
    await card.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(live.getByText('all three tests pass now.')).toBeVisible({ timeout: 8000 });
    await expect(live.getByRole('status').filter({ hasText: 'Idle' })).toBeVisible();
  });

  test('reduced motion removes movement but keeps the content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'awaiting-permission');
    const move = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--move').trim());
    expect(move).toBe('0px');
    await expect(page.getByRole('alert', { name: /Needs your OK/ })).toBeVisible();
  });
});

test.describe('theme', () => {
  test('the gallery switches theme by hand and remembers it', async ({ page }) => {
    await page.goto('/dev/tokens');
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

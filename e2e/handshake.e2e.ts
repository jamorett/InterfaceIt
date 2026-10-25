import { expect, test } from '@playwright/test';
import { TOKEN } from './token.ts';

test('the link from the terminal connects and the token leaves the address bar', async ({ page }) => {
  await page.goto(`/#t=${TOKEN}`);
  await expect(page.getByRole('status')).toHaveText('Connected');
  expect(page.url()).not.toContain(TOKEN);
});

test('a reload keeps the session without the hash', async ({ page }) => {
  await page.goto(`/#t=${TOKEN}`);
  await expect(page.getByRole('status')).toHaveText('Connected');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Connected');
});

test('opening the bare address asks for the terminal link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Open the link printed in the terminal');
});

test('a wrong token asks for the terminal link', async ({ page }) => {
  await page.goto(`/#t=${'f'.repeat(64)}`);
  await expect(page.getByRole('status')).toContainText('Open the link printed in the terminal');
});

test('a request with a foreign Host header is refused', async ({ request }) => {
  const res = await request.get('/', { headers: { host: 'evil.example' } });
  expect(res.status()).toBe(403);
});

import type { Page } from '@playwright/test';

/** Cards and panels that stick out past the window edge. The page itself may not scroll sideways, but an inner scroll container can hide a card that does. */
export const offscreen = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section, form, aside, main, header, footer, nav, [role="alert"], [role="group"]')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`),
  );

/** Fails with Vite's own message when the dev build is broken, instead of 200 tests timing out on a page nobody can click. */
export async function assertNoBuildError(page: Page) {
  const message = await page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    return o ? o.shadowRoot?.querySelector('.message')?.textContent ?? 'unknown build error' : undefined;
  });
  if (message) throw new Error(`The dev build is broken: ${message.slice(0, 400)}`);
}

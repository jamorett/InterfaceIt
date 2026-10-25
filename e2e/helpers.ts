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

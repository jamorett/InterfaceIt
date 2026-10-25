import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { scenarioNames } from '../ui/src/dev/scenario-names.ts';
import { assertNoBuildError, offscreen } from './helpers.ts';

// M0 acceptance (PLAN.md §11): every state of §7.1 at all four widths, light and dark,
// with zero axe violations (contrast included) and no horizontal scroll of the page.
const widths = [360, 720, 1024, 1440];
const schemes = ['light', 'dark'] as const;
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: import('@playwright/test').Page, exclude: string[] = []) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(0);
  expect(await offscreen(page), 'these cards extend past the window').toEqual([]);
  const builder = new AxeBuilder({ page }).withTags(tags);
  for (const e of exclude) builder.exclude(e);
  const { violations } = await builder.analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

for (const scheme of schemes) {
  for (const width of widths) {
    test.describe(`${scheme} @ ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 }, reducedMotion: 'reduce' });
      for (const name of scenarioNames) {
        test(name, async ({ page }) => {
          await page.goto(`/dev/shell?state=${name}`);
          await Promise.race([page.locator('[data-ready]').waitFor(), page.waitForSelector('vite-error-overlay', { state: 'attached' }).then(() => assertNoBuildError(page))]);
          await audit(page);
        });
      }
    });
  }
}

test.describe('design gallery', () => {
  for (const scheme of schemes) {
    for (const width of [360, 1440]) {
      test(`${scheme} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.goto('/dev/tokens');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // the preview iframe shows the very scenarios audited above, and axe would catch it mid-fade
        await audit(page, ['iframe']);
      });
    }
  }
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { scenarioNames } from '../ui/src/dev/scenario-names.ts';

// M0 acceptance (PLAN.md §11): every state of §7.1 at all four widths, light and dark,
// with zero axe violations (contrast included) and no horizontal scroll of the page.
const widths = [360, 720, 1024, 1440];
const schemes = ['light', 'dark'] as const;
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

for (const scheme of schemes) {
  for (const width of widths) {
    test.describe(`${scheme} @ ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 }, reducedMotion: 'reduce' });
      for (const name of scenarioNames) {
        test(name, async ({ page }) => {
          await page.goto(`/dev/shell?state=${name}`);
          await page.locator('[data-ready]').waitFor();
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
        await audit(page);
      });
    }
  }
});

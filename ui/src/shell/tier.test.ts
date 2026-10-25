import { describe, expect, it } from 'vitest';
import { tierFor } from './tier.ts';

describe('tierFor', () => {
  it.each([
    [320, 'narrow'], [360, 'narrow'], [719, 'narrow'],
    [720, 'tablet'], [1023, 'tablet'],
    [1024, 'laptop'], [1439, 'laptop'],
    [1440, 'desktop'], [2560, 'desktop'],
  ] as const)('%ipx is %s', (w, tier) => {
    expect(tierFor(w)).toBe(tier);
  });
});

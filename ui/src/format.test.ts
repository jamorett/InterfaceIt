import { describe, expect, it } from 'vitest';
import { ago, resetsAt } from './format.ts';

// noon on a fixed day, so "same day" and "next day" do not depend on the time zone
const now = new Date(2026, 9, 25, 12, 0, 0).getTime();
const at = (days: number, h = 12) => new Date(2026, 9, 25 + days, h, 0, 0).getTime();

describe('ago', () => {
  it('speaks in short human units', () => {
    expect(ago(now - 5_000, now)).toBe('now');
    expect(ago(now - 4 * 60_000, now)).toBe('4m');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h');
    expect(ago(at(-1, 23), now)).toBe('yesterday');
    expect(ago(at(-3), now)).toMatch(/^[A-Za-zÀ-ÿ.]+$/); // a weekday name
    expect(ago(at(-30), now)).toMatch(/\d/); // a date
  });
});

describe('resetsAt', () => {
  it('shows only the time when it is today, otherwise says which day', () => {
    expect(resetsAt(at(0, 22) / 1000, now)).toMatch(/^\d{1,2}[:.]\d{2}$/);
    expect(resetsAt(at(1, 6) / 1000, now)).toMatch(/^tomorrow \d{1,2}[:.]\d{2}$/);
    expect(resetsAt(at(3, 6) / 1000, now)).toMatch(/\d{1,2}[:.]\d{2}$/);
    expect(resetsAt(at(3, 6) / 1000, now)).not.toMatch(/tomorrow/);
  });
});

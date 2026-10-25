import { describe, expect, it } from 'vitest';
import { formatTokens, middleTruncate, percent } from './text.ts';

describe('middleTruncate', () => {
  it('leaves short text alone', () => {
    expect(middleTruncate('src/store.ts', 40)).toBe('src/store.ts');
  });
  it('keeps the start and the end, never exceeds max', () => {
    const p = 'C:\\Users\\someone\\Documents\\project\\packages\\ui\\src\\transcript\\Message.tsx';
    const out = middleTruncate(p, 40);
    expect(out).toHaveLength(40);
    expect(out.startsWith('C:\\Users')).toBe(true);
    expect(out.endsWith('Message.tsx')).toBe(true);
    expect(out).toContain('…');
  });
  it('survives tiny limits and empty input', () => {
    expect(middleTruncate('abcdefghij', 3)).toBe('abc');
    expect(middleTruncate('', 10)).toBe('');
  });
});

describe('formatTokens / percent', () => {
  it('formats magnitudes', () => {
    expect([formatTokens(950), formatTokens(1234), formatTokens(30485), formatTokens(1_000_000)]).toEqual(['950', '1.2k', '30k', '1.0M']);
  });
  it('clamps percentages', () => {
    expect([percent(0.844), percent(-1), percent(3)]).toEqual(['84%', '0%', '100%']);
  });
});

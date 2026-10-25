import { describe, expect, it } from 'vitest';
import { countChanges, lineDiff } from './diff.ts';

const kinds = (d: ReturnType<typeof lineDiff>) => d.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`);

describe('lineDiff', () => {
  it('shows only the lines that changed, not the whole block', () => {
    expect(kinds(lineDiff('a\nb\nc\nd', 'a\nB\nc\nd'))).toEqual([' a', '-b', '+B', ' c', ' d']);
  });
  it('handles pure additions and removals', () => {
    expect(kinds(lineDiff('a\nb', 'a\nb\nc'))).toEqual([' a', ' b', '+c']);
    expect(kinds(lineDiff('a\nb\nc', 'a\nc'))).toEqual([' a', '-b', ' c']);
    expect(kinds(lineDiff('', 'new\nfile'))).toEqual(['+new', '+file']);
    expect(kinds(lineDiff('gone', ''))).toEqual(['-gone']);
  });
  it('returns nothing for two empty texts, and only context for identical ones', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('same', 'same').every((l) => l.kind === 'ctx')).toBe(true);
  });
  it('numbers lines on each side', () => {
    const d = lineDiff('a\nb\nc', 'a\nX\nc');
    expect(d.find((l) => l.kind === 'del')).toMatchObject({ oldNo: 2 });
    expect(d.find((l) => l.kind === 'add')).toMatchObject({ newNo: 2 });
    expect(d.find((l) => l.text === 'c')).toMatchObject({ oldNo: 3, newNo: 3 });
  });
  it('folds long unchanged stretches and says how many lines it hid', () => {
    const lots = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const after = [...lots];
    after[15] = 'CHANGED';
    const d = lineDiff(lots.join('\n'), after.join('\n'), 2);
    expect(d.filter((l) => l.fold).map((l) => l.text)).toEqual(['… 13 unchanged lines', '… 12 unchanged lines']); // 30 lines, two of context each side of the change
    expect(kinds(d).filter((l) => l[0] !== ' ' || l.startsWith(' line'))).toContain('-line 15');
    expect(d.length).toBeLessThan(12);
  });
  it('treats Windows and Unix line endings the same', () => {
    expect(lineDiff('a\r\nb', 'a\nb').every((l) => l.kind === 'ctx')).toBe(true);
  });
  it('falls back to remove-all / add-all for huge input instead of freezing', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `l${i}`).join('\n');
    const d = lineDiff(big, big + '\nmore');
    expect(d).toHaveLength(4001);
    expect(d[0]).toMatchObject({ kind: 'del' });
  });
  it('counts', () => {
    expect(countChanges(lineDiff('a\nb', 'a\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });
});

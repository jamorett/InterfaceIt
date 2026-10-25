import { describe, expect, it } from 'vitest';
import { highlight, isKnownLanguage, MAX_HIGHLIGHT_CHARS } from './highlight.ts';

describe('highlight', () => {
  it('colours keywords, strings and comments through the theme variables', async () => {
    const lines = (await highlight('const a = "x"; // note', 'ts'))!;
    const tokens = lines.flat();
    expect(tokens.some((t) => t.color === 'var(--shiki-token-keyword)' && t.content === 'const')).toBe(true);
    expect(tokens.some((t) => t.color === 'var(--shiki-token-string-expression)' || t.color === 'var(--shiki-token-string)')).toBe(true);
    expect(tokens.some((t) => t.color === 'var(--shiki-token-comment)')).toBe(true);
    expect(tokens.every((t) => !t.color || t.color.startsWith('var(--shiki-'))).toBe(true); // never a literal colour
  });

  it('keeps every character of the code, in order, and one entry per line', async () => {
    const code = 'function f(a) {\n  return a + 1;\n}';
    const lines = (await highlight(code, 'js'))!;
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.map((t) => t.content).join('')).join('\n')).toBe(code);
  });

  it('understands the aliases people write (ts, sh, py, yml)', async () => {
    for (const l of ['ts', 'sh', 'py', 'yml', 'TS']) expect(isKnownLanguage(l), l).toBe(true);
    expect(await highlight('x = 1', 'py')).toBeDefined();
  });

  it('returns nothing for an unknown language, no language, or an enormous block (it is then shown plain)', async () => {
    expect(await highlight('x', 'not-a-language')).toBeUndefined();
    expect(await highlight('x', undefined)).toBeUndefined();
    expect(await highlight('x'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'ts')).toBeUndefined();
    expect(isKnownLanguage('__proto__')).toBe(false);
    expect(isKnownLanguage('constructor')).toBe(false);
  });

  it('treats markup in the code as text', async () => {
    const lines = (await highlight('<script>alert(1)</script>', 'html'))!;
    expect(lines.flat().map((t) => t.content).join('')).toBe('<script>alert(1)</script>');
  });
});

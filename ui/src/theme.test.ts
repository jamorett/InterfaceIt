import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function block(re: RegExp): Record<string, string> {
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`theme.css block not found: ${re}`);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const light = block(/:root\s*\{\s*color-scheme: light;([^}]*)\}/);
const darkAuto = block(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
const darkManual = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const surfaces = ['--bg', '--surface', '--surface-sunken'];
// [foreground, backgrounds it appears on]
const pairs: [string, string[]][] = [
  ['--text', surfaces],
  ['--text-muted', surfaces],
  ['--primary', surfaces],
  ['--danger', surfaces],
  ['--warning', surfaces],
  ['--primary-contrast', ['--primary-fill']],
  ['--attention-text', ['--attention']],
];

describe.each([['light', light], ['dark', darkManual]] as const)('%s theme', (_name, t) => {
  it.each(pairs.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))('%s on %s reaches WCAG AA (4.5:1)', (fg, bg) => {
    expect(t[fg], `${fg} missing`).toMatch(/^#[0-9A-F]{6}$/i);
    expect(t[bg], `${bg} missing`).toMatch(/^#[0-9A-F]{6}$/i);
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('code colours', () => {
  const shiki = Object.fromEntries([...css.matchAll(/(--shiki-[\w-]+)\s*:\s*var\((--[\w-]+)\)\s*;/g)].map((m) => [m[1]!, m[2]!]));
  const readableOnCode = pairs.filter(([, bgs]) => bgs.includes('--surface-sunken')).map(([fg]) => fg);

  it('defines the colours Shiki asks for', () => {
    for (const v of ['foreground', 'background', 'token-keyword', 'token-string', 'token-constant', 'token-comment', 'token-function', 'token-parameter', 'token-punctuation', 'token-link', 'token-string-expression']) {
      expect(shiki[`--shiki-${v}`], v).toBeTruthy();
    }
  });
  it('uses only tokens that reach AA on the code background, in light and dark', () => {
    for (const [name, token] of Object.entries(shiki)) {
      if (name === '--shiki-background') continue;
      expect(readableOnCode, `${name} → ${token}`).toContain(token);
    }
    expect(shiki['--shiki-background']).toBe('--surface-sunken');
  });
});

describe('palette', () => {
  it('uses the four given colours for their roles', () => {
    expect(light['--bg']).toBe('#FAF8F1');
    expect(light['--attention']).toBe('#FAEAB1');
    expect(light['--primary']).toBe('#34656D');
    expect(light['--text']).toBe('#334443');
    expect(darkManual['--text']).toBe('#FAF8F1');
    expect(darkManual['--primary-fill']).toBe('#34656D');
  });

  it('keeps the OS-driven dark block identical to the manual [data-theme="dark"] block', () => {
    const { 'color-scheme': _ignored, ...auto } = darkAuto;
    expect(auto).toEqual(darkManual);
  });

  it('defines the same tokens in light and dark', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(darkManual).sort());
  });
});

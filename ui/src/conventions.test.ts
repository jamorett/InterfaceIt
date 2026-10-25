import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('.', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// PLAN.md §14.7: colours only in theme.css; the skills' "never ship" list for motion
const sources = walk(root).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('theme.css'));
const rules: [string, RegExp][] = [
  ['hex colour outside theme.css', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb()/hsl() colour outside theme.css', /\b(rgb|hsl)a?\(/],
  ['transition: all', /transition(-property)?:\s*all\b|\btransition-all\b/],
  ['ease-in on UI', /\bease-in\b(?!-out)/],
  ['scale(0) entrance', /scale\(0\)|\bscale-0\b/],
];

describe('code conventions', () => {
  it('found the UI sources', () => {
    expect(sources.length).toBeGreaterThan(3);
  });
  it.each(rules)('no %s', (_name, re) => {
    const hits = sources.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});

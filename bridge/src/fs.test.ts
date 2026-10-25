import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { score, searchFiles } from './fs.ts';

let root: string;
let outside: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ci-fs-'));
  outside = mkdtempSync(join(tmpdir(), 'ci-outside-'));
  const put = (p: string) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), 'x'); };
  for (const p of ['README.md', 'ui/src/store.ts', 'ui/src/store.test.ts', 'ui/src/App.tsx', 'bridge/src/session.ts', 'node_modules/pkg/index.js', 'dist/bundle.js', '.git/config', '.env', 'docs/store-notes.md']) put(p);
  writeFileSync(join(outside, 'secret.txt'), 'top secret');
  try { symlinkSync(outside, join(root, 'link-out'), 'junction'); } catch { /* links may need rights on Windows: the test then just has nothing to prove */ }
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

describe('searchFiles', () => {
  it('finds files by part of their name, best match first, with forward slashes', () => {
    const r = searchFiles(root, 'store');
    expect(r[0]).toBe('ui/src/store.ts'); // the name starts with it and is shortest
    expect(r).toContain('ui/src/store.test.ts');
    expect(r).toContain('docs/store-notes.md');
  });
  it('matches folders too, and letters in order', () => {
    expect(searchFiles(root, 'bridge')).toEqual(['bridge/src/session.ts']);
    expect(searchFiles(root, 'sst')).toContain('ui/src/store.ts');
  });
  it('lists some files for an empty query, shortest paths first', () => {
    const r = searchFiles(root, '');
    expect(r[0]).toBe('README.md');
    expect(r.length).toBeGreaterThan(3);
  });
  it('never offers dependencies, build output, git data or dot-files', () => {
    const all = searchFiles(root, '', 100);
    expect(all.some((p) => p.includes('node_modules') || p.startsWith('dist/') || p.startsWith('.git/') || p === '.env')).toBe(false);
  });
  it('does not follow a link out of the folder', () => {
    expect(searchFiles(root, 'secret', 100)).toEqual([]);
    expect(searchFiles(root, '', 100).some((p) => p.includes('link-out') || p.includes('secret'))).toBe(false);
  });
  it('respects the limit and survives a folder that does not exist', () => {
    expect(searchFiles(root, '', 2)).toHaveLength(2);
    expect(searchFiles(join(root, 'nope'), 'x')).toEqual([]);
  });
});

describe('score', () => {
  it('ranks name matches above folder matches above scattered letters', () => {
    expect(score('a/store.ts', 'store.ts')).toBeGreaterThan(score('store/a.ts', 'store'));
    expect(score('store/a.ts', 'store')).toBeGreaterThan(score('s/t/o/r/e.ts', 'store'));
    expect(score('a.ts', 'zzz')).toBe(0);
  });
});

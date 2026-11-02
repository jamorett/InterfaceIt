import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeGrep } from './grep.ts';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'grep-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'one\ntwo NEEDLE\nthree\nfour\n');
  writeFileSync(join(dir, 'src', 'b.md'), 'needle in docs\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('grep', () => {
  it('filters by glob and is case-insensitive by default', async () => {
    const all = await executeGrep({ query: 'needle' }, dir);
    expect(all.matchCount).toBe(2);
    const ts = await executeGrep({ query: 'needle', glob: '*.ts' }, dir);
    expect(ts.text).toContain('a.ts');
    expect(ts.text).not.toContain('b.md');
    expect((await executeGrep({ query: 'needle', case_sensitive: true }, dir)).text).toContain('b.md');
  });
  it('shows context lines around a match', async () => {
    const r = await executeGrep({ query: 'NEEDLE', glob: '*.ts', context: 1 }, dir);
    expect(r.text).toContain('src/a.ts-1- one');
    expect(r.text).toContain('src/a.ts:2: two NEEDLE');
    expect(r.text).toContain('src/a.ts-3- three');
    expect(r.text).not.toContain('four');
  });
  it('lists only file names on request', async () => {
    const r = await executeGrep({ query: 'needle', files_only: true }, dir);
    expect(r.text.split('\n').sort()).toEqual(['src/a.ts', 'src/b.md']);
  });
});

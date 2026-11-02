import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeEdit } from './edit.ts';
import { executeWrite } from './write.ts';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'ci-edit-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const file = (name: string, text: string) => { writeFileSync(join(dir, name), text); return name; };
const read = (name: string) => readFileSync(join(dir, name), 'utf-8');

describe('edit_file', () => {
  it('replaces an exact match and keeps CRLF files CRLF', async () => {
    const f = file('a.txt', 'one\r\ntwo\r\nthree\r\n');
    const r = await executeEdit({ path: f, old_string: 'two', new_string: 'TWO' }, dir);
    expect(r.isError).toBe(false);
    expect(read(f)).toBe('one\r\nTWO\r\nthree\r\n');
  });

  it('a match that only holds ignoring trailing spaces really changes the file (it used to report success and change nothing)', async () => {
    const f = file('b.txt', 'keep\nfoo(1);   \nbar(2);\nend\n');
    const r = await executeEdit({ path: f, old_string: 'foo(1);\nbar(2);', new_string: 'baz();' }, dir);
    expect(r.isError).toBe(false);
    expect(read(f)).toBe('keep\nbaz();\nend\n');
  });

  it('when the text is not there, the error shows the closest lines so the next try can be exact', async () => {
    const f = file('c.ts', 'import x from "x";\nexport function computeTotal(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
    const r = await executeEdit({ path: f, old_string: 'export function computeTotal(list: number[]) {', new_string: 'x' }, dir);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('closest text in the file is around line 2');
    expect(r.text).toContain('2→export function computeTotal(items: number[]) {');
    expect(read(f)).toContain('computeTotal(items'); // untouched
  });

  it('two agents editing the same file at once both keep their change', async () => {
    const f = file('d.txt', 'A=1\nB=1\nC=1\nD=1\n');
    const edits = ['A', 'B', 'C', 'D'].map((k) => executeEdit({ path: f, old_string: `${k}=1`, new_string: `${k}=2` }, dir));
    expect((await Promise.all(edits)).every((r) => !r.isError)).toBe(true);
    expect(read(f)).toBe('A=2\nB=2\nC=2\nD=2\n'); // without the lock the last writer erased the others
  });

  it('a write and edits on one file do not interleave', async () => {
    const f = file('e.txt', 'x');
    await Promise.all([executeWrite({ path: f, content: 'first=1\nsecond=1\n' }, dir), executeEdit({ path: f, old_string: 'second=1', new_string: 'second=2' }, dir)]);
    expect(read(f)).toBe('first=1\nsecond=2\n');
  });
});

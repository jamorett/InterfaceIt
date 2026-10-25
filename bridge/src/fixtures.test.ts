import { readdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
const files = readdirSync(dir);

describe('recorded fixtures', () => {
  it('exist (run bridge/scripts/probe.ts to record them)', () => {
    expect(files.filter((f) => f.endsWith('.jsonl')).length).toBeGreaterThan(5);
  });

  it.each(files.filter((f) => f.endsWith('.jsonl')))('%s is valid JSONL', (f) => {
    for (const line of readFileSync(join(dir, f), 'utf8').trim().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // fixtures are committed: the probe must have removed everything personal
  it.each(files)('%s has no personal data', (f) => {
    const text = readFileSync(join(dir, f), 'utf8').toLowerCase();
    const needles = [homedir(), homedir().replaceAll('\\', '\\\\'), userInfo().username, '@gmail.', '@outlook.', '@hotmail.']
      .map((n) => n.toLowerCase())
      .filter((n) => n.length > 4); // a short username like "user" would match ordinary words
    for (const n of needles) expect(text, `found "${n}"`).not.toContain(n);
  });
});

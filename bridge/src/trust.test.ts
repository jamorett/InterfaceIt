import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTrusted, norm, trust, type TrustFiles } from './trust.ts';

let dir: string;
let files: TrustFiles;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ci-trust-'));
  files = { store: join(dir, 'app', 'trusted.json'), cliConfig: join(dir, 'claude.json') };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('trust', () => {
  it('trusts nothing by default, also when neither file exists', () => {
    expect(isTrusted(join(dir, 'proj'), files)).toBe(false);
  });

  it('remembers a folder the user said yes to, and everything under it', () => {
    trust(join(dir, 'proj'), files);
    expect(isTrusted(join(dir, 'proj'), files)).toBe(true);
    expect(isTrusted(join(dir, 'proj', 'src', 'deep'), files)).toBe(true);
    expect(isTrusted(join(dir, 'other'), files)).toBe(false);
  });

  it('does not duplicate entries', () => {
    trust(join(dir, 'proj'), files);
    trust(join(dir, 'proj'), files);
    expect((JSON.parse(require('node:fs').readFileSync(files.store, 'utf8')) as unknown[]).length).toBe(1);
  });

  it('honours what the user already trusted in the CLI, including parent folders', () => {
    writeFileSync(files.cliConfig, JSON.stringify({ projects: { [norm(join(dir, 'parent'))]: { hasTrustDialogAccepted: true }, [norm(join(dir, 'no'))]: { hasTrustDialogAccepted: false } } }));
    expect(isTrusted(join(dir, 'parent', 'child'), files)).toBe(true);
    expect(isTrusted(join(dir, 'no'), files)).toBe(false);
  });

  it('survives corrupt files', () => {
    writeFileSync(files.cliConfig, '{not json');
    expect(isTrusted(join(dir, 'x'), files)).toBe(false);
    trust(join(dir, 'x'), files);
    writeFileSync(files.store, 'garbage');
    expect(isTrusted(join(dir, 'x'), files)).toBe(false);
    expect(() => trust(join(dir, 'y'), files)).not.toThrow();
  });

  it('compares paths the way the OS does (slashes, case on Windows, trailing slash)', () => {
    expect(norm('C:\\Users\\Me\\proj\\')).toBe(process.platform === 'win32' ? 'c:/users/me/proj' : norm('C:\\Users\\Me\\proj\\'));
    if (process.platform === 'win32') expect(norm('C:\\Users\\Me\\Proj')).toBe(norm('c:/users/me/proj'));
  });
});

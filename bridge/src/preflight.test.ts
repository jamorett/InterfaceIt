import { describe, expect, it } from 'vitest';
import { bundledBinary, isOlder, parseAuthStatus, parseVersion } from './preflight.ts';
import { recentFrom } from './history.ts';

describe('parseAuthStatus', () => {
  const real = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'someone@example.com', orgId: 'org-123', orgName: "someone's Organization", subscriptionType: 'pro', configDirectory: 'C:\\Users\\someone\\.claude' });

  it('keeps only what the UI may know', () => {
    const out = parseAuthStatus(real);
    expect(out).toEqual({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' });
    const text = JSON.stringify(out);
    for (const secret of ['someone', 'example.com', 'org-123', 'Users']) expect(text).not.toContain(secret);
  });
  it('treats logged-out, garbage and empty output as not logged in', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toMatchObject({ loggedIn: false });
    expect(parseAuthStatus('not json')).toEqual({ loggedIn: false });
    expect(parseAuthStatus('')).toEqual({ loggedIn: false });
    expect(parseAuthStatus('{"loggedIn":"yes"}').loggedIn).toBe(false);
  });
});

describe('versions', () => {
  it('reads the number out of the CLI banner', () => {
    expect(parseVersion('2.1.310 (Claude Code)')).toEqual([2, 1, 310]);
    expect(parseVersion('nope')).toBeUndefined();
  });
  it('flags only versions below the minimum', () => {
    expect(isOlder([2, 0, 99])).toBe(true);
    expect(isOlder([1, 9, 9])).toBe(true);
    expect(isOlder([2, 1, 0])).toBe(false);
    expect(isOlder([2, 1, 310])).toBe(false);
    expect(isOlder([3, 0, 0])).toBe(false);
  });
});

describe('environment', () => {
  it('finds the binary that ships with the SDK on this machine', () => {
    expect(bundledBinary()).toMatch(/claude(\.exe)?$/);
  });
});

describe('recentFrom', () => {
  it('lists each folder once, newest first, up to the limit', () => {
    const s = (cwd: string, updated: number) => ({ id: cwd + updated, cwd, title: '', updated, live: false });
    expect(recentFrom([s('a', 1), s('b', 5), s('a', 9), s('c', 3)], 2)).toEqual(['a', 'b']);
    expect(recentFrom([])).toEqual([]);
  });
});

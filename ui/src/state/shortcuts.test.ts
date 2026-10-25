import { describe, expect, it } from 'vitest';
import { nextMode } from './modes.ts';
import { notificationFor } from './notify.ts';

describe('nextMode', () => {
  it('cycles through the everyday modes and wraps', () => {
    expect(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'].map((m) => nextMode(m as never))).toEqual(['acceptEdits', 'plan', 'auto', 'dontAsk', 'default']);
  });
  it('never lands on bypassPermissions, and leaves it for the start of the cycle', () => {
    let m = nextMode('default' as never);
    for (let i = 0; i < 20; i++) m = nextMode(m);
    expect(m).not.toBe('bypassPermissions');
    expect(nextMode('bypassPermissions')).toBe('default');
  });
});

describe('notificationFor', () => {
  it('says when Claude needs you', () => {
    expect(notificationFor('running', 'awaiting_permission', 'proj')).toMatchObject({ body: 'proj', title: expect.stringMatching(/approval|OK|needs/i) });
    expect(notificationFor('running', 'awaiting_answer', 'proj')?.title).toMatch(/question/i);
  });
  it('says when a turn is finished, but not after an answer you just gave', () => {
    expect(notificationFor('running', 'idle', 'p')?.title).toMatch(/done|finished/i);
    expect(notificationFor('awaiting_permission', 'idle', 'p')).toBeUndefined();
    expect(notificationFor(undefined, 'idle', 'p')).toBeUndefined(); // the first status of a session is not news
  });
  it('says about limits and failures', () => {
    expect(notificationFor('running', 'rate_limited', 'p')?.title).toMatch(/limit/i);
    expect(notificationFor('running', 'error', 'p')?.title).toMatch(/wrong|error|failed/i);
  });
  it('stays quiet for everything else and for no change', () => {
    for (const s of ['running', 'compacting', 'retrying', 'ended'] as const) expect(notificationFor('idle', s, 'p')).toBeUndefined();
    expect(notificationFor('idle', 'idle', 'p')).toBeUndefined();
    expect(notificationFor('awaiting_permission', 'awaiting_permission', 'p')).toBeUndefined();
  });
});

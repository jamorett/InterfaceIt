import { describe, expect, it } from 'vitest';
import { complete, fitSize, matchCommands, triggerAt } from './triggers.ts';

describe('triggerAt', () => {
  it('sees a slash command only at the start', () => {
    expect(triggerAt('/rev', 4)).toMatchObject({ kind: 'slash', query: 'rev' });
    expect(triggerAt('see /rev', 8)).toBeUndefined();
  });
  it('sees an @ word under the caret, not inside an email', () => {
    expect(triggerAt('open @src/ap', 12)).toMatchObject({ kind: 'file', query: 'src/ap', start: 5 });
    expect(triggerAt('mail me@example.com', 19)).toBeUndefined();
  });
  it('stops once the word is finished', () => {
    expect(triggerAt('@a b', 4)).toBeUndefined();
  });
});

describe('complete', () => {
  it('replaces the typed word and puts the caret after it', () => {
    const t = triggerAt('open @sr', 8)!;
    expect(complete('open @sr', t, '@src/App.tsx')).toEqual({ text: 'open @src/App.tsx ', caret: 18 });
  });
});

describe('matchCommands', () => {
  it('puts prefix matches first', () => {
    expect(matchCommands([{ name: 'review' }, { name: 'preview' }, { name: 'rewind' }], 're').map((c) => c.name)).toEqual(['review', 'rewind', 'preview']);
  });
});

describe('fitSize', () => {
  it('shrinks big pictures and keeps small ones', () => {
    expect(fitSize(4000, 2000)).toEqual({ w: 2000, h: 1000 });
    expect(fitSize(300, 200)).toEqual({ w: 300, h: 200 });
  });
});

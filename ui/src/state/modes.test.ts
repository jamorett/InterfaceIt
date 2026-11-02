import { describe, expect, it } from 'vitest';
import { effortsFor, nextMode } from './modes.ts';

describe('effortsFor', () => {
  const models = [
    { value: 'default', efforts: ['low' as const] },
    { value: 'haiku', efforts: ['low' as const, 'medium' as const] },
    { value: 'nvidia/x', efforts: ['high' as const] },
  ];
  it('matches an exact id, then an alias inside a full id', () => {
    expect(effortsFor(models, 'nvidia/x')).toEqual(['high']);
    expect(effortsFor(models, 'claude-haiku-5-5')).toEqual(['low', 'medium']);
    expect(effortsFor(models, 'default')).toEqual(['low']);
  });
  it('has nothing for an unknown model or none', () => {
    expect(effortsFor(models, 'claude-unknown')).toBeUndefined();
    expect(effortsFor(models, undefined)).toBeUndefined();
  });
});

describe('nextMode', () => {
  it('cycles and sends bypass back to the start', () => {
    expect(nextMode('default')).toBe('acceptEdits');
    expect(nextMode('bypassPermissions')).toBe('default');
  });
});

import { isNvidiaModel, nvidiaModelChoices } from '@ci/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NVIDIA_MODEL, getNvidiaModel, NVIDIA_MODELS } from './models.ts';

describe('NVIDIA model list', () => {
  it('the bridge and the selector offer the same models, with labels from the one list', () => {
    expect(NVIDIA_MODELS.map((m) => [m.value, m.label])).toEqual(nvidiaModelChoices.map((c) => [c.value, c.label]));
  });
  it('the default is offered, and every model is recognised as NVIDIA\'s', () => {
    expect(NVIDIA_MODELS.some((m) => m.value === DEFAULT_NVIDIA_MODEL)).toBe(true);
    for (const m of NVIDIA_MODELS) expect(isNvidiaModel(m.value)).toBe(true);
  });
  it('every model has a window and an output size, and an unknown id still gets safe defaults', () => {
    for (const m of NVIDIA_MODELS) expect(m.contextWindow).toBeGreaterThan(m.defaultMaxTokens);
    expect(getNvidiaModel('x/unknown').contextWindow).toBe(32_000);
  });
});

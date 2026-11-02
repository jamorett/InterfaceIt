import { isNvidiaModel, nvidiaModelChoices } from '@ci/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NVIDIA_MODEL, getNvidiaModel, NVIDIA_MODELS, thinkingParams } from './models.ts';

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

describe('thinking parameters per model', () => {
  const m = (id: string) => getNvidiaModel(id);
  it('off really sends enable_thinking false on the Nemotron models', () => {
    for (const id of ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3-ultra-550b-a55b']) {
      expect(thinkingParams(m(id), false, 'high'), id).toEqual({ enableThinking: false });
    }
  });
  it('on adds a reasoning budget where the model takes one', () => {
    expect(thinkingParams(m('nvidia/nemotron-3.5-super-vl-120b-a12b'), true, 'low')).toEqual({ enableThinking: true, reasoningBudget: 2048 });
    // thinking never takes more than half of max_tokens (16384 here), so a long tool call still fits
    expect(thinkingParams(m('nvidia/nemotron-3.5-lightning-30b-a3b'), true, 'max')).toEqual({ enableThinking: true, reasoningBudget: 8192 });
    expect(thinkingParams(m('nvidia/nemotron-3.5-lightning-30b-a3b'), true, 'high')).toEqual({ enableThinking: true, reasoningBudget: 8192 });
    expect(thinkingParams(m('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'), true, 'max')).toEqual({ enableThinking: true, reasoningBudget: 32768 }); // 65536 max_tokens
  });
  it('Ultra needs force_nonempty_content with tools and uses medium_effort for low and medium effort', () => {
    const ultra = m('nvidia/nemotron-3-ultra-550b-a55b');
    expect(thinkingParams(ultra, true, 'medium')).toEqual({ enableThinking: true, templateKwargs: { force_nonempty_content: true, medium_effort: true } });
    expect(thinkingParams(ultra, true, 'high')).toEqual({ enableThinking: true, templateKwargs: { force_nonempty_content: true } });
  });
  it('a model whose thinking cannot be switched, or an unknown one, gets nothing', () => {
    expect(thinkingParams(m('mistralai/mistral-large-4-1t-a52b'), false, 'low')).toEqual({});
    expect(thinkingParams(m('x/unknown'), true, 'high')).toEqual({});
  });
  it('sampling follows the model cards: 1.0 for text, 0.6 for Super with images and for Omni', () => {
    expect(m('nvidia/nemotron-3.5-super-vl-120b-a12b').sampling).toEqual({ temperature: 1.0, topP: 0.95, imageTemperature: 0.6 });
    expect(m('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning').sampling.temperature).toBe(0.6);
  });
});

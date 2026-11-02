import { nvidiaModelChoices, type Effort } from '@ci/shared';

export interface NvidiaModelInfo {
  value: string;
  label: string;
  description: string;
  supportsThinking: boolean;
  /** `chat_template_kwargs.enable_thinking` really switches the reasoning on and off (checked on the API, 2026-11-02) */
  thinkingToggle: boolean;
  supportsVision: boolean;
  /** a top-level `reasoning_budget` caps the thinking (checked on the API) */
  supportsReasoningBudget: boolean;
  /** Ultra: tool calls need `force_nonempty_content`, and `medium_effort` cuts the thinking to about a fifth */
  ultraStyle?: boolean;
  /** the sampling the model's card recommends */
  sampling: { temperature: number; topP: number; /** with images in the prompt */ imageTemperature?: number };
  defaultMaxTokens: number;
  /** prompt window in tokens. shortcut: conservative guesses, the catalog API does not report them; correct when known. */
  contextWindow: number;
  efforts: Effort[];
  fast: boolean;
}

export const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

type Caps = Omit<NvidiaModelInfo, 'value' | 'label'>;

// the list of models and their labels lives in @ci/shared; `satisfies` makes a model without capabilities a compile error
const CAPS = {
  'nvidia/nemotron-3.5-super-vl-120b-a12b': {
    description: 'Flagship 120B reasoning and vision model. The default for the main agent.',
    supportsThinking: true, thinkingToggle: true, supportsVision: true, supportsReasoningBudget: true,
    sampling: { temperature: 1.0, topP: 0.95, imageTemperature: 0.6 },
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'nvidia/nemotron-3.5-lightning-30b-a3b': {
    description: 'Fast 30B reasoning model. Good for subagents, drafting and quick searches.',
    supportsThinking: true, thinkingToggle: true, supportsVision: false, supportsReasoningBudget: true,
    sampling: { temperature: 1.0, topP: 0.95 },
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: true,
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    description: 'Multimodal 30B reasoning model with image input and up to 64k tokens of output.',
    supportsThinking: true, thinkingToggle: true, supportsVision: true, supportsReasoningBudget: true,
    sampling: { temperature: 0.6, topP: 0.95 },
    defaultMaxTokens: 65536, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'nvidia/nemotron-3-ultra-550b-a55b': {
    description: 'The largest Nemotron. For hard problems where quality matters more than speed (it is slow: a hard question can take a minute or more).',
    supportsThinking: true, thinkingToggle: true, supportsVision: false, supportsReasoningBudget: false, ultraStyle: true,
    sampling: { temperature: 1.0, topP: 0.95 },
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'mistralai/mistral-large-4-1t-a52b': {
    description: 'Very large Mistral model. Noticeably slower to answer than the Nemotron ones. It always reasons: its thinking cannot be switched off.',
    supportsThinking: true, thinkingToggle: false, supportsVision: false, supportsReasoningBudget: false,
    sampling: { temperature: 1.0, topP: 0.95 },
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
} satisfies Record<(typeof nvidiaModelChoices)[number]['value'], Caps>;

export const NVIDIA_MODELS: NvidiaModelInfo[] = nvidiaModelChoices.map((c) => ({ ...c, ...CAPS[c.value] }));

export function getNvidiaModel(modelId?: string): NvidiaModelInfo {
  const found = NVIDIA_MODELS.find((m) => m.value === modelId);
  if (found) return found;
  return {
    value: modelId || DEFAULT_NVIDIA_MODEL,
    label: modelId || DEFAULT_NVIDIA_MODEL,
    description: 'Custom NVIDIA NIM Model',
    supportsThinking: true,
    thinkingToggle: false, // unknown model: leave thinking to its own default
    supportsVision: true,
    supportsReasoningBudget: false,
    sampling: { temperature: 0.7, topP: 0.95 },
    defaultMaxTokens: 16384,
    contextWindow: 32_000,
    efforts: ['medium'],
    fast: false,
  };
}

/** How much thinking each effort level allows, in tokens (a cap, not a target). */
export const REASONING_BUDGET: Record<Effort, number> = { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 32768 };

export interface ThinkingParams {
  enableThinking?: boolean;
  reasoningBudget?: number;
  templateKwargs?: Record<string, unknown>;
}

/** The request parameters for "thinking on or off at this effort" on this model; nothing for a model whose thinking cannot be switched. */
export function thinkingParams(model: NvidiaModelInfo, thinking: boolean, effort: Effort): ThinkingParams {
  if (!model.thinkingToggle) return {};
  if (!thinking) return { enableThinking: false };
  const p: ThinkingParams = { enableThinking: true };
  // thinking counts against max_tokens: at most half of it, or a long reply (a whole file in a tool call) is cut off mid-JSON
  if (model.supportsReasoningBudget) p.reasoningBudget = Math.min(REASONING_BUDGET[effort], Math.floor(model.defaultMaxTokens / 2));
  if (model.ultraStyle) p.templateKwargs = { force_nonempty_content: true, ...(effort === 'low' || effort === 'medium' ? { medium_effort: true } : {}) };
  return p;
}

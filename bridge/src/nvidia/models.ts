import { nvidiaModelChoices, type Effort } from '@ci/shared';

export interface NvidiaModelInfo {
  value: string;
  label: string;
  description: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsReasoningBudget: boolean;
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
    supportsThinking: true, supportsVision: true, supportsReasoningBudget: true,
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'nvidia/nemotron-3.5-lightning-30b-a3b': {
    description: 'Fast 30B reasoning model. Good for subagents, drafting and quick searches.',
    supportsThinking: true, supportsVision: false, supportsReasoningBudget: true,
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: true,
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    description: 'Multimodal 30B reasoning model with image input and up to 64k tokens of output.',
    supportsThinking: true, supportsVision: true, supportsReasoningBudget: true,
    defaultMaxTokens: 65536, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'nvidia/nemotron-3-ultra-550b-a55b': {
    description: 'The largest Nemotron. For hard problems where quality matters more than speed.',
    supportsThinking: true, supportsVision: false, supportsReasoningBudget: false,
    defaultMaxTokens: 16384, contextWindow: 128_000, efforts: ['low', 'medium', 'high', 'max'], fast: false,
  },
  'mistralai/mistral-large-4-1t-a52b': {
    description: 'Very large Mistral model. Noticeably slower to answer than the Nemotron ones.',
    supportsThinking: true, supportsVision: false, supportsReasoningBudget: false,
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
    supportsVision: true,
    supportsReasoningBudget: true,
    defaultMaxTokens: 16384,
    contextWindow: 32_000,
    efforts: ['medium'],
    fast: false,
  };
}

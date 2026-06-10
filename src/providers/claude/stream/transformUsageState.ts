export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface PromptUsageSnapshot {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextTokens: number;
}

export interface TransformUsageState {
  clear(): void;
  mergePromptUsage(usage: MessageUsage): PromptUsageSnapshot;
  getPromptUsage(): PromptUsageSnapshot;
  hasEmitted(promptUsage: PromptUsageSnapshot): boolean;
  markEmitted(promptUsage: PromptUsageSnapshot): void;
  markWindowAuthoritative(): void;
  isWindowAuthoritative(): boolean;
}

const EMPTY_PROMPT_USAGE: PromptUsageSnapshot = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  contextTokens: 0,
};

function normalizeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function hasPromptUsageField(usage: unknown): usage is MessageUsage {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return false;
  }

  const record = usage as Record<string, unknown>;
  return typeof record.input_tokens === 'number'
    || typeof record.cache_creation_input_tokens === 'number'
    || typeof record.cache_read_input_tokens === 'number';
}

export function toPromptUsageSnapshot(usage: MessageUsage): PromptUsageSnapshot {
  const inputTokens = normalizeTokenCount(usage.input_tokens);
  const cacheCreationInputTokens = normalizeTokenCount(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = normalizeTokenCount(usage.cache_read_input_tokens);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function mergePromptUsage(
  current: PromptUsageSnapshot,
  usage: MessageUsage,
): PromptUsageSnapshot {
  const next = toPromptUsageSnapshot(usage);
  // Cache fields are monotone-within-turn (the SDK never *un-caches* tokens it already
  // reported). inputTokens is NOT monotone: the SDK may report the per-turn input on the
  // first assistant message and a slightly different value on a later stream_event/
  // message_delta. Use the latest snapshot for inputTokens and high-water-mark only
  // for cache fields, so the recorded total tracks the SDK's view of the current turn.
  const inputTokens = next.inputTokens > 0 ? next.inputTokens : current.inputTokens;
  const cacheCreationInputTokens = Math.max(current.cacheCreationInputTokens, next.cacheCreationInputTokens);
  const cacheReadInputTokens = Math.max(current.cacheReadInputTokens, next.cacheReadInputTokens);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    contextTokens: inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function samePromptUsage(a: PromptUsageSnapshot, b: PromptUsageSnapshot): boolean {
  return a.inputTokens === b.inputTokens
    && a.cacheCreationInputTokens === b.cacheCreationInputTokens
    && a.cacheReadInputTokens === b.cacheReadInputTokens
    && a.contextTokens === b.contextTokens;
}

export function createTransformUsageState(): TransformUsageState {
  let promptUsage: PromptUsageSnapshot = { ...EMPTY_PROMPT_USAGE };
  let lastEmittedPromptUsage: PromptUsageSnapshot | null = null;
  let windowAuthoritative = false;

  return {
    clear(): void {
      promptUsage = { ...EMPTY_PROMPT_USAGE };
      lastEmittedPromptUsage = null;
      windowAuthoritative = false;
    },

    mergePromptUsage(usage: MessageUsage): PromptUsageSnapshot {
      promptUsage = mergePromptUsage(promptUsage, usage);
      return promptUsage;
    },

    getPromptUsage(): PromptUsageSnapshot {
      return { ...promptUsage };
    },

    hasEmitted(nextPromptUsage: PromptUsageSnapshot): boolean {
      return lastEmittedPromptUsage !== null && samePromptUsage(lastEmittedPromptUsage, nextPromptUsage);
    },

    markEmitted(nextPromptUsage: PromptUsageSnapshot): void {
      lastEmittedPromptUsage = { ...nextPromptUsage };
    },

    markWindowAuthoritative(): void {
      windowAuthoritative = true;
    },

    isWindowAuthoritative(): boolean {
      return windowAuthoritative;
    },
  };
}

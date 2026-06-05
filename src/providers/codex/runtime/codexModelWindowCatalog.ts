import type { ModelPricing } from '../../../core/providers/types';

interface CatalogEntry {
  contextWindow: number;
  pricing?: ModelPricing;
}

const DEFAULT_WINDOW = 200_000;

const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'gpt-5.2': { contextWindow: 400_000 },
  'gpt-5.3-codex': { contextWindow: 400_000 },
  'gpt-5.3-codex-spark': { contextWindow: 128_000 },
};

export function codexModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return 0;
  return CATALOG[modelId]?.contextWindow ?? 0;
}

export function codexModelPricing(modelId: string | undefined): ModelPricing | null {
  if (!modelId) return null;
  return CATALOG[modelId]?.pricing ?? null;
}

export const CODEX_DEFAULT_CONTEXT_WINDOW = DEFAULT_WINDOW;

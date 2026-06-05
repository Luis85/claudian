import type { ModelPricing } from '../../../core/providers/types';

interface CatalogEntry {
  contextWindow: number;
  pricing?: ModelPricing;
}

const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  'gemini-2.5-pro': { contextWindow: 1_000_000 },
  'gemini-1.5-pro': { contextWindow: 1_000_000 },
  'gpt-5': { contextWindow: 400_000 },
  'gpt-4.1': { contextWindow: 400_000 },
  'claude-sonnet-4': { contextWindow: 200_000 },
  'claude-opus-4': { contextWindow: 200_000 },
  'claude-haiku-4': { contextWindow: 200_000 },
  'composer-2': { contextWindow: 200_000 },
  'composer-2-sonnet-research': { contextWindow: 200_000 },
  'sonic-1': { contextWindow: 200_000 },
  'grok-4': { contextWindow: 200_000 },
};

export function cursorModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return 0;
  return CATALOG[modelId]?.contextWindow ?? 0;
}

export function cursorModelPricing(modelId: string | undefined): ModelPricing | null {
  if (!modelId) return null;
  return CATALOG[modelId]?.pricing ?? null;
}

export function cursorKnownModelIds(): string[] {
  return Object.keys(CATALOG);
}

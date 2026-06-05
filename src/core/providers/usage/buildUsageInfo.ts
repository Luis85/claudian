import type { UsageInfo } from '../../types';

export interface BuildUsageInfoParams {
  model: string;
  inputTokens: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  thoughtTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative?: boolean;
  costUsd?: number;
}

export function clampPercentage(used: number, window: number): number {
  if (!Number.isFinite(window) || window <= 0) {
    return 0;
  }
  const ratio = Math.round((used / window) * 100);
  return Math.min(100, Math.max(0, ratio));
}

export function buildUsageInfo(params: BuildUsageInfoParams): UsageInfo {
  if (!params.model || typeof params.model !== 'string' || !params.model.trim()) {
    throw new Error('buildUsageInfo: model id is required');
  }
  const window = Math.max(0, Math.floor(params.contextWindow));
  const contextTokens = Math.max(0, Math.floor(params.contextTokens));
  const usage: UsageInfo = {
    model: params.model,
    inputTokens: Math.max(0, Math.floor(params.inputTokens)),
    contextWindow: window,
    contextTokens,
    percentage: clampPercentage(contextTokens, window),
  };
  if (params.outputTokens !== undefined) usage.outputTokens = Math.max(0, Math.floor(params.outputTokens));
  if (params.reasoningOutputTokens !== undefined) usage.reasoningOutputTokens = Math.max(0, Math.floor(params.reasoningOutputTokens));
  if (params.thoughtTokens !== undefined) usage.thoughtTokens = Math.max(0, Math.floor(params.thoughtTokens));
  if (params.cacheCreationInputTokens !== undefined) usage.cacheCreationInputTokens = Math.max(0, Math.floor(params.cacheCreationInputTokens));
  if (params.cacheReadInputTokens !== undefined) usage.cacheReadInputTokens = Math.max(0, Math.floor(params.cacheReadInputTokens));
  if (params.contextWindowIsAuthoritative !== undefined) usage.contextWindowIsAuthoritative = params.contextWindowIsAuthoritative;
  if (params.costUsd !== undefined && Number.isFinite(params.costUsd)) usage.costUsd = params.costUsd;
  return usage;
}

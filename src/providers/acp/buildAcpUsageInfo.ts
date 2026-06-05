import { buildUsageInfo } from '../../core/providers/usage';
import type { UsageInfo } from '../../core/types';
import type { AcpUsage, AcpUsageUpdate } from './types';

export interface BuildAcpUsageInfoParams {
  contextWindow?: AcpUsageUpdate | null;
  model: string;
  promptUsage?: AcpUsage | null;
}

export function buildAcpUsageInfo(params: BuildAcpUsageInfoParams): UsageInfo | null {
  const promptUsage = params.promptUsage ?? null;
  const contextWindow = params.contextWindow ?? null;

  if (!promptUsage && !contextWindow) {
    return null;
  }

  const contextTokens = contextWindow?.used ?? promptUsage?.totalTokens ?? 0;
  const contextWindowSize = contextWindow?.size ?? 0;
  const cost = contextWindow?.cost;
  const costUsd = cost && cost.currency === 'USD' && Number.isFinite(cost.amount) ? cost.amount : undefined;

  // Pass through only the AcpUsage fields that were actually defined. Pass `undefined` (not 0)
  // for missing optional fields so the shared builder omits them entirely from the persisted
  // UsageInfo (avoiding phantom zeros).
  const cachedRead = promptUsage?.cachedReadTokens;
  const cachedWrite = promptUsage?.cachedWriteTokens;
  const thought = promptUsage?.thoughtTokens;
  const output = promptUsage?.outputTokens;

  return buildUsageInfo({
    model: params.model,
    inputTokens: promptUsage?.inputTokens ?? 0,
    outputTokens: typeof output === 'number' ? output : undefined,
    thoughtTokens: typeof thought === 'number' ? thought : undefined,
    cacheCreationInputTokens: typeof cachedWrite === 'number' ? cachedWrite : undefined,
    cacheReadInputTokens: typeof cachedRead === 'number' ? cachedRead : undefined,
    contextTokens,
    contextWindow: contextWindowSize,
    contextWindowIsAuthoritative: Boolean(contextWindow),
    costUsd,
  });
}

import { cursorModelContextWindow } from './cursorModelWindowCatalog';

export interface CursorUsage {
  inputTokens: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative: boolean;
  percentage: number;
}

function numericField(source: unknown, keys: string[]): number | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/** Cursor exposes usage on `rec.usage` or `rec.message.usage` (first match wins). */
function readUsageObject(rec: Record<string, unknown>): Record<string, unknown> | undefined {
  if (rec.usage && typeof rec.usage === 'object') {
    return rec.usage as Record<string, unknown>;
  }
  if (rec.message && typeof rec.message === 'object') {
    const nested = (rec.message as Record<string, unknown>).usage;
    if (nested && typeof nested === 'object') {
      return nested as Record<string, unknown>;
    }
  }
  return undefined;
}

interface CursorTokenCounts {
  input?: number;
  output?: number;
  cacheRead?: number;
  contextTokens: number;
}

function readTokenCounts(
  rec: Record<string, unknown>,
  usageObj: Record<string, unknown> | undefined,
): CursorTokenCounts {
  const input = numericField(usageObj, ['input_tokens', 'inputTokens']);
  const output = numericField(usageObj, ['output_tokens', 'outputTokens']);
  const total =
    numericField(usageObj, ['total_tokens', 'totalTokens']) ??
    numericField(rec, ['num_tokens', 'tokens']);
  const cacheRead = numericField(usageObj, ['cache_read_input_tokens']);

  let contextTokens = 0;
  if (typeof total === 'number') {
    contextTokens = total;
  } else if (typeof input === 'number' || typeof output === 'number' || typeof cacheRead === 'number') {
    contextTokens = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0);
  }

  return { input, output, cacheRead, contextTokens };
}

interface CursorContextWindow {
  contextWindow: number;
  isAuthoritative: boolean;
}

function resolveContextWindow(
  rec: Record<string, unknown>,
  usageObj: Record<string, unknown> | undefined,
  model: string | undefined,
): CursorContextWindow {
  const explicitWindow =
    numericField(usageObj, ['context_window', 'contextWindow', 'context_size']) ??
    numericField(rec, ['context_window', 'contextWindow', 'context_size']);
  if (typeof explicitWindow === 'number' && explicitWindow > 0) {
    return { contextWindow: explicitWindow, isAuthoritative: true };
  }
  const catalogWindow = cursorModelContextWindow(model);
  return { contextWindow: catalogWindow, isAuthoritative: catalogWindow > 0 };
}

function contextPercentage(contextTokens: number, contextWindow: number): number {
  if (contextTokens <= 0 || contextWindow <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((contextTokens / contextWindow) * 100)));
}

// The shape of Cursor's token/usage data is undocumented, so probe several
// plausible locations (first match wins) and never throw on odd input.
export function extractCursorUsage(
  rec: Record<string, unknown>,
  model: string | undefined,
): CursorUsage {
  const usageObj = readUsageObject(rec);
  const { input, output, cacheRead, contextTokens } = readTokenCounts(rec, usageObj);
  const { contextWindow, isAuthoritative } = resolveContextWindow(rec, usageObj, model);

  const result: CursorUsage = {
    inputTokens: typeof input === 'number' ? input : 0,
    contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: isAuthoritative,
    percentage: contextPercentage(contextTokens, contextWindow),
  };
  if (typeof output === 'number') result.outputTokens = output;
  if (typeof cacheRead === 'number') result.cacheReadInputTokens = cacheRead;
  return result;
}

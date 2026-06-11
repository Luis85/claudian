import type { StreamChunk } from '../../../core/types/chat';
import { CODEX_DEFAULT_CONTEXT_WINDOW } from './codexModelWindowCatalog';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function getNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function numericField(source: unknown, keys: string[]): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function stringifyPayloadValue(raw: unknown): string {
  try {
    const result = JSON.stringify(raw);
    return typeof result === 'string' ? result : String(raw);
  } catch {
    return String(raw);
  }
}

export function extractResponseItemMessageText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';

  return raw
    .map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

function extractTextFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      return isRecord(part) && typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

export function extractResponseItemReasoningText(raw: Record<string, unknown>): string {
  if (Array.isArray(raw.summary) && raw.summary.length > 0) {
    return extractTextFromParts(raw.summary);
  }

  if (Array.isArray(raw.content) && raw.content.length > 0) {
    return extractTextFromParts(raw.content);
  }

  return typeof raw.text === 'string' ? raw.text : '';
}

// ---------------------------------------------------------------------------
// SessionTailState
// ---------------------------------------------------------------------------

export interface ResponseItemTailState {
  emittedToolUseIds: Set<string>;
  emittedToolResultIds: Set<string>;
  knownCalls: Map<string, { toolName: string; toolInput: unknown }>;
}

export interface CallEnrichmentData {
  exitCode?: number;
  mcpServer?: string;
  mcpTool?: string;
}

export interface SessionTailState {
  responseItemState: ResponseItemTailState;
  currentTurnId: string | null;
  syntheticTurnCounter: number;
  modelContextWindow: number;
  modelContextWindowIsAuthoritative: boolean;
  lastTextByTurn: Map<string, string>;
  lastThinkingByTurn: Map<string, string>;
  pendingUsageByTurn: Map<string, {
    inputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    cacheReadInputTokens: number;
    contextTokens: number;
    contextWindow: number;
    contextWindowIsAuthoritative: boolean;
  }>;
  emittedDoneByTurn: Set<string>;
  emittedUsageByTurn: Set<string>;
  callEnrichment: Map<string, CallEnrichmentData>;
  /**
   * Optional accessor providing the active Codex model at usage-emission time.
   * The dormant `CodexFileTailEngine` path threads this through so the
   * `task_complete` arm can route the chunk through `sharedBuildUsageInfo`,
   * which requires a non-empty model. If absent or returning empty string, the
   * tail silently drops the usage chunk (matches Cursor mapper behavior).
   */
  getActiveModel?: () => string;
}

export function createSessionTailState(
  fallbackContextWindow: number = CODEX_DEFAULT_CONTEXT_WINDOW,
  getActiveModel?: () => string,
): SessionTailState {
  return {
    responseItemState: {
      emittedToolUseIds: new Set(),
      emittedToolResultIds: new Set(),
      knownCalls: new Map(),
    },
    currentTurnId: null,
    syntheticTurnCounter: 0,
    modelContextWindow: fallbackContextWindow,
    modelContextWindowIsAuthoritative: false,
    lastTextByTurn: new Map(),
    lastThinkingByTurn: new Map(),
    pendingUsageByTurn: new Map(),
    emittedDoneByTurn: new Set(),
    emittedUsageByTurn: new Set(),
    callEnrichment: new Map(),
    ...(getActiveModel ? { getActiveModel } : {}),
  };
}

// ---------------------------------------------------------------------------
// Delta emission helper
// ---------------------------------------------------------------------------

export function emitDelta(
  fullText: string,
  lastSeenMap: Map<string, string>,
  turnId: string,
  chunkType: 'text' | 'thinking',
): StreamChunk[] {
  if (!fullText) return [];

  const lastSeen = lastSeenMap.get(turnId) ?? '';
  if (fullText.length <= lastSeen.length) return [];

  const delta = fullText.slice(lastSeen.length);
  lastSeenMap.set(turnId, fullText);
  return [{ type: chunkType, content: delta }];
}

// ---------------------------------------------------------------------------
// Turn ID resolution
// ---------------------------------------------------------------------------

export function resolveTurnId(
  state: SessionTailState,
  preferredTurnId: string | undefined,
): string {
  if (preferredTurnId) return preferredTurnId;
  if (state.currentTurnId) return state.currentTurnId;
  const id = `synthetic-turn-${state.syntheticTurnCounter}`;
  state.syntheticTurnCounter += 1;
  return id;
}

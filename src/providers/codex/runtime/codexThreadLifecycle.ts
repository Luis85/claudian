import type { ChatRuntimeQueryOptions, PreparedChatTurn } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { buildContextFromHistory } from '../../../utils/session';
import { DEFAULT_CODEX_PRIMARY_MODEL, FAST_TIER_CODEX_MODEL } from '../types/models';

export interface CodexThreadContext {
  turn: PreparedChatTurn;
  threadId: string;
  threadPath: string | null;
  threadTargetPath: string | null;
}

const EFFORT_MAP: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

export function resolveCodexEffort(effortLevel: unknown): string {
  return EFFORT_MAP[effortLevel as string] ?? 'medium';
}

export function validateCompactTurn(turn: PreparedChatTurn): string | null {
  if (!turn.isCompact) {
    return null;
  }

  if (turn.request.text.trim() !== '/compact') {
    return '/compact does not accept arguments';
  }

  return null;
}

export function resolveExternalContextPaths(
  turn: PreparedChatTurn,
  queryOptions?: ChatRuntimeQueryOptions,
): string[] {
  const externalContextPaths = turn.request.externalContextPaths ?? queryOptions?.externalContextPaths ?? [];
  return [...new Set(externalContextPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

export function resolveCodexServiceTier(serviceTier: unknown, model: string | undefined): string | null {
  if (model !== FAST_TIER_CODEX_MODEL) {
    return null;
  }
  return serviceTier === 'fast' ? 'fast' : null;
}

interface ThreadSessionParams {
  model: string;
  approvalPolicy: string;
  sandbox: string;
  serviceTier: string | null;
  baseInstructions: string;
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
}

export function buildThreadSessionParams(
  model: string | undefined,
  promptText: string,
  permission: { approvalPolicy: string; sandbox: string },
  serviceTierSetting: unknown,
): ThreadSessionParams {
  return {
    model: model ?? DEFAULT_CODEX_PRIMARY_MODEL,
    approvalPolicy: permission.approvalPolicy,
    sandbox: permission.sandbox,
    serviceTier: resolveCodexServiceTier(serviceTierSetting, model ?? DEFAULT_CODEX_PRIMARY_MODEL),
    baseInstructions: promptText,
    experimentalRawEvents: true,
    persistExtendedHistory: true,
  };
}

// Compute rollback: count turns after the resumeAt checkpoint
export function computeForkRollbackCount(
  forkTurns: ReadonlyArray<{ id: string }>,
  resumeAt: string,
): number {
  const checkpointIndex = forkTurns.findIndex(t => t.id === resumeAt);
  if (checkpointIndex < 0) {
    throw new Error(`Fork checkpoint not found: ${resumeAt}`);
  }
  return forkTurns.length - checkpointIndex - 1;
}

// Build replay suffix from conversation history after the checkpoint
export function applyForkReplaySuffix(
  turn: PreparedChatTurn,
  history: ChatMessage[] | undefined,
  resumeAt: string,
): PreparedChatTurn {
  if (!history || history.length === 0) {
    return turn;
  }

  const checkpointIdx = history.findIndex(m => m.assistantMessageId === resumeAt);
  if (checkpointIdx < 0 || checkpointIdx >= history.length - 1) {
    return turn;
  }

  const replayContext = buildContextFromHistory(history.slice(checkpointIdx + 1));
  if (!replayContext.trim()) {
    return turn;
  }

  return {
    ...turn,
    prompt: `${replayContext}\n\nUser: ${turn.prompt}`,
  };
}

import type { StreamChunk, UsageInfo } from '../../../core/types';

/**
 * Provider-neutral stream projection (ARCH-6, Decisions 3 & 4).
 *
 * Turns a `StreamChunk` plus the current projection state into explicit, DOM-free
 * decisions that the StreamController applies through its existing rendering/scheduling
 * code. This module owns assistant-message *semantics* only — block-transition
 * ordering (which open block to finalize before a new content type), the text/notice/error
 * content that gets appended, compact-boundary transitions, and usage two-phase
 * filtering (current-vs-stale session, subagent-cumulative skip, ignore flag, model
 * stamping). It must stay free of DOM, Obsidian, vault, and provider process state so
 * stream correctness is unit-testable with plain chunk sequences. Concerns it deliberately
 * does NOT own: rAF/throttle scheduling, scrolling, DOM element lifecycle, vault file
 * effects, and provider Subagent lifecycle — those remain inline in StreamController.
 */

/** Snapshot of the controller's open-block state that block-transition decisions depend on. */
export interface ProjectionBlockState {
  hasOpenTextBlock: boolean;
  hasOpenThinkingBlock: boolean;
}

/** What an open content block must do before a new content type is appended. */
export interface BlockTransitionDecision {
  /** Flush buffered (not-yet-rendered) tool calls before rendering the new content type. */
  flushPendingTools: boolean;
  /** Finalize the currently-open thinking block before continuing. */
  finalizeThinking: boolean;
  /** Finalize the currently-open text block before continuing. */
  finalizeText: boolean;
}

/** Inputs that decide whether a usage chunk should update message state. */
export interface UsageProjectionInput {
  /** Session id reported by the active runtime, or null when no session is active. */
  currentSessionId: string | null;
  /** Whether any subagents were spawned this stream (SDK reports cumulative usage). */
  subagentsSpawnedThisStream: number;
  /** Whether the controller is currently suppressing usage updates (session reset). */
  ignoreUsageUpdates: boolean;
  /** Active provider model, used to stamp usage that arrives without a model. */
  activeProviderModel: string | undefined;
}

/** Result of projecting a usage chunk. */
export type UsageProjectionDecision =
  | { action: 'ignore' }
  | { action: 'update'; usage: UsageInfo };

/**
 * Block-transition rule shared by text/thinking/tool_use chunks: a new content type must
 * flush buffered tools and close whatever incompatible block is open before its own
 * content renders. This mirrors the original switch arms exactly:
 * - thinking: flush tools, finalize an open text block.
 * - text: flush tools, finalize an open thinking block.
 * - tool_use: finalize an open thinking block, then always finalize text (a no-op when
 *   none is open), matching the original unconditional `finalizeCurrentTextBlock` call.
 */
export function projectBlockTransition(
  chunkType: 'text' | 'thinking' | 'tool_use',
  state: ProjectionBlockState,
): BlockTransitionDecision {
  switch (chunkType) {
    case 'thinking':
      return {
        flushPendingTools: true,
        finalizeThinking: false,
        finalizeText: state.hasOpenTextBlock,
      };
    case 'text':
      return {
        flushPendingTools: true,
        finalizeThinking: state.hasOpenThinkingBlock,
        finalizeText: false,
      };
    case 'tool_use':
      return {
        flushPendingTools: false,
        finalizeThinking: state.hasOpenThinkingBlock,
        finalizeText: true,
      };
  }
}

/**
 * Compact-boundary projection: flush tools, finalize an open thinking block, then always
 * finalize text (matching the original `context_compacted` arm). The caller records the
 * `context_compacted` content block and renders the boundary.
 */
export function projectCompactBoundary(state: ProjectionBlockState): BlockTransitionDecision {
  return {
    flushPendingTools: true,
    finalizeThinking: state.hasOpenThinkingBlock,
    finalizeText: true,
  };
}

/** The user-facing text appended for a notice chunk. `warning` renders as "Blocked". */
export function projectNoticeText(chunk: Extract<StreamChunk, { type: 'notice' }>): string {
  const label = chunk.level === 'warning' ? 'Blocked' : 'Notice';
  return `\n\n⚠️ **${label}:** ${chunk.content}`;
}

/**
 * Usage two-phase filtering. Drops usage from a different session (or any session-tagged
 * usage when no session is active yet), drops cumulative usage once subagents ran, and
 * honors the ignore flag. Otherwise stamps the active model when the provider omitted it,
 * preserving authoritative usage exactly as received.
 */
export function projectUsage(
  chunk: Extract<StreamChunk, { type: 'usage' }>,
  input: UsageProjectionInput,
): UsageProjectionDecision {
  const chunkSessionId = chunk.sessionId ?? null;
  const { currentSessionId } = input;

  if (
    (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
    (chunkSessionId && !currentSessionId)
  ) {
    return { action: 'ignore' };
  }

  if (input.subagentsSpawnedThisStream > 0) {
    return { action: 'ignore' };
  }

  if (input.ignoreUsageUpdates) {
    return { action: 'ignore' };
  }

  const usage =
    input.activeProviderModel && !chunk.usage.model
      ? { ...chunk.usage, model: input.activeProviderModel }
      : chunk.usage;

  return { action: 'update', usage };
}

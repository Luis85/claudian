import type { ToolCallInfo } from '../../../core/types';

/**
 * O(1) id → tool-call lookup for the streaming hot path.
 *
 * During a long tool-heavy turn the renderer repeatedly resolves a streamed
 * chunk's `id` against the message's accumulated tool calls. A linear
 * `toolCalls.find(tc => tc.id === id)` makes that per-chunk cost grow with the
 * number of tools already in the turn — O(tools²) over the turn. This index
 * keeps the lookup constant.
 *
 * Designed as an *accelerator*, not a source of truth: {@link ToolCallIndex.get}
 * falls back to a linear scan of the backing array when the map misses, so the
 * persisted `msg.toolCalls` array remains authoritative and correctness never
 * depends on the index being perfectly in sync.
 */
export class ToolCallIndex {
  private readonly byId = new Map<string, ToolCallInfo>();

  /** Records a tool call for O(1) retrieval. Safe to call repeatedly. */
  add(toolCall: ToolCallInfo): void {
    this.byId.set(toolCall.id, toolCall);
  }

  /** Indexes every tool call in `toolCalls`, e.g. after hydrating a message. */
  reindex(toolCalls: readonly ToolCallInfo[] | undefined): void {
    this.byId.clear();
    if (!toolCalls) return;
    for (const toolCall of toolCalls) {
      this.byId.set(toolCall.id, toolCall);
    }
  }

  /**
   * Resolves a tool call by id, preferring the O(1) map and falling back to a
   * linear scan of `toolCalls` (the authoritative array) on a miss. The fallback
   * keeps results correct even if a tool call was appended without indexing.
   */
  get(id: string, toolCalls: readonly ToolCallInfo[] | undefined): ToolCallInfo | undefined {
    const indexed = this.byId.get(id);
    if (indexed) return indexed;
    return toolCalls?.find(tc => tc.id === id);
  }

  /** Drops all indexed entries (e.g. when a new turn starts). */
  clear(): void {
    this.byId.clear();
  }
}

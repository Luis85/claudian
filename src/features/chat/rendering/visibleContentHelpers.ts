/**
 * Specorator - message visibility predicates.
 *
 * Extracted from MessageRenderer so `hasVisibleContent` stays below the
 * complexity thresholds: the per-block-type switch carries most of the
 * branching weight and is pure once tool visibility is supplied as a callback.
 */

import type { ChatMessage, ContentBlock } from '../../../core/types';

/**
 * Whether a single content block contributes visible output. `isToolVisible`
 * resolves a `tool_use` block's id against the message's tool calls and the
 * renderer's render policy; it owns all instance state so this stays pure.
 */
export function contentBlockHasVisibleContent(
  block: ContentBlock,
  isToolVisible: (toolId: string) => boolean,
): boolean {
  switch (block.type) {
    case 'thinking':
    case 'text':
      return block.content.trim().length > 0;
    case 'context_compacted':
    case 'runtime_error':
    case 'subagent':
      return true;
    case 'tool_use':
      return isToolVisible(block.toolId);
    default:
      return false;
  }
}

/** True when any content block in the message is visible. */
export function hasVisibleBlock(
  blocks: ContentBlock[] | undefined,
  isToolVisible: (toolId: string) => boolean,
): boolean {
  return Boolean(blocks?.some(block => contentBlockHasVisibleContent(block, isToolVisible)));
}

/** True when the message carries non-empty plain text content. */
export function hasVisibleText(msg: ChatMessage): boolean {
  return Boolean(msg.content && msg.content.trim().length > 0);
}

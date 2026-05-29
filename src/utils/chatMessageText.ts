import type { ChatMessage } from '../core/types';

/**
 * Plain prose text of a chat message, regardless of role.
 *
 * User messages carry their prose in `content`. Assistant messages stream their
 * prose into `contentBlocks` text blocks and leave `content` empty, so fall back
 * to joining those blocks. Returns a trimmed string ('' when there is no prose,
 * e.g. a tool-only assistant turn).
 */
export function chatMessageText(message: ChatMessage): string {
  const direct = message.content?.trim();
  if (direct) return direct;

  return (message.contentBlocks ?? [])
    .filter((block): block is { type: 'text'; content: string } => block.type === 'text')
    .map((block) => block.content)
    .join('\n\n')
    .trim();
}

import type { ChatMessage } from '../../core/types';
import { chatMessageText } from '../../utils/chatMessageText';

const COMMAND_PREFIXES = ['/', '$', '#', '!'] as const;

/**
 * Prose the user authored, regardless of provider-injected context.
 *
 * Live sends keep the raw user input in `displayContent`. Messages rehydrated
 * from history may have `displayContent` undefined, so we fall back to
 * `chatMessageText`, which already handles both `content` and `contentBlocks`.
 */
export function visibleText(message: ChatMessage): string {
  const direct = (message.displayContent ?? '').trim();
  return direct || chatMessageText(message);
}

/**
 * Predicate for the "Capture as quick action" toolbar button. We capture only
 * user-authored prose; assistant turns, empty/image-only sends, and command-
 * style messages (slash commands, $ skills, # instruction mode, ! bang-bash)
 * are not reusable as quick-action prompts.
 */
export function isCaptureEligible(message: ChatMessage): boolean {
  if (message.role !== 'user') return false;
  const text = visibleText(message);
  if (!text) return false;
  const firstChar = text.charAt(0);
  return !(COMMAND_PREFIXES as readonly string[]).includes(firstChar);
}

/**
 * Seed for the `name` field in `QuickActionEditorModal`. We take the first
 * non-empty line, trim it, and truncate to `maxLen` characters with an
 * ellipsis. The editor still requires a non-empty name on save, so this is
 * only a starting point — the user can always rewrite it before committing.
 */
export function deriveSeedName(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen).trimEnd() + '…';
}

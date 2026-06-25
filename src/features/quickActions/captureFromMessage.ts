import { Notice } from 'obsidian';

import type { ChatMessage } from '../../core/types';
import { t } from '../../i18n/i18n';
import type SpecoratorPlugin from '../../main';
import { chatMessageText } from '../../utils/chatMessageText';
import { QuickActionEditorModal } from './ui/QuickActionEditorModal';

const COMMAND_PREFIXES = new Set(['/', '$', '#', '!']);

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
  return !COMMAND_PREFIXES.has(text.charAt(0));
}

/**
 * Seed for the `name` field in `QuickActionEditorModal`. We take the first
 * non-empty line, trim it, and truncate to `maxLen` code points with an
 * ellipsis. Slicing by code point (not UTF-16 code unit) avoids leaving a
 * lone surrogate before the ellipsis on CJK/emoji input. The editor still
 * requires a non-empty name on save, so this is only a starting point — the
 * user can always rewrite it before committing.
 */
export function deriveSeedName(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const chars = Array.from(firstLine);
  if (chars.length <= maxLen) return firstLine;
  return chars.slice(0, maxLen).join('').trimEnd() + '…';
}

/**
 * Opens the quick-action editor pre-filled with this message's prose and a
 * derived name. The folder check fires before the modal is constructed so a
 * misconfigured vault never lands the user in a half-broken save flow.
 *
 * Side-effects on save (in order): write file, toast, refresh favorites cache,
 * open the saved note. `openLinkText` failures are logged and swallowed —
 * the save itself already succeeded.
 *
 * Reuses `plugin.quickActionStorage` (the plugin-lifetime singleton that also
 * backs `QuickActionFavoritesCache`) rather than constructing a fresh storage
 * per click.
 */
export function openCaptureFromMessage(
  plugin: SpecoratorPlugin,
  message: ChatMessage,
): void {
  const folder = plugin.settings.quickActionsFolder?.trim() ?? '';
  if (!folder) {
    new Notice(t('quickActions.capture.folderMissing'));
    return;
  }

  const prompt = visibleText(message);
  if (!prompt) return;

  const seedName = deriveSeedName(prompt);
  const storage = plugin.quickActionStorage;

  new QuickActionEditorModal(
    plugin.app,
    null,
    async (action) => {
      const filePath = await storage.save(action);
      new Notice(t('quickActions.capture.saved'));
      plugin.quickActionFavoritesCache?.refresh();
      try {
        await plugin.app.workspace.openLinkText(filePath, '', 'tab');
      } catch (err) {
        plugin.logger.scope('quickActions').warn('openLinkText after capture failed', err);
      }
    },
    storage,
    { name: seedName, prompt },
  ).open();
}

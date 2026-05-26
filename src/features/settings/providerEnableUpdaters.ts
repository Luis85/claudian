import type { ProviderId } from '../../core/providers/types';
import { updateClaudeProviderSettings } from '../../providers/claude/settings';
import { updateCodexProviderSettings } from '../../providers/codex/settings';
import { updateCursorProviderSettings } from '../../providers/cursor/settings';
import { updateOpencodeProviderSettings } from '../../providers/opencode/settings';

/** Applies an `enabled` change to the correct provider's settings slice. */
export type ProviderEnableUpdater = (
  settings: Record<string, unknown>,
  enabled: boolean,
) => void;

/**
 * Maps each provider id to the per-provider update function that toggles its
 * `enabled` flag. Keeping this isolated keeps the settings tab tidy and lets the
 * mapping be unit-tested without the Obsidian Setting DOM.
 */
export const PROVIDER_ENABLE_UPDATERS: Record<ProviderId, ProviderEnableUpdater> = {
  claude: (settings, enabled) => updateClaudeProviderSettings(settings, { enabled }),
  cursor: (settings, enabled) => updateCursorProviderSettings(settings, { enabled }),
  codex: (settings, enabled) => updateCodexProviderSettings(settings, { enabled }),
  opencode: (settings, enabled) => updateOpencodeProviderSettings(settings, { enabled }),
};

/** Returns the enable updater for a provider, or null when unknown. */
export function getProviderEnableUpdater(providerId: ProviderId): ProviderEnableUpdater | null {
  return PROVIDER_ENABLE_UPDATERS[providerId] ?? null;
}
